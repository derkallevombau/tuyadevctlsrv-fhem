/*
 * fhem-client.js
 *
 *  Created on: Fri Oct 04 2019
 *      Author: derkallevombau
 */

const http = require('http');
const https = require('https');

/**
 * @typedef { (message: any, ...args: any[]) => void } LoggerMethod
 * @typedef {{ debug: LoggerMethod, info: LoggerMethod, warn: LoggerMethod, error: LoggerMethod }} Logger
 */

/**
 * A small Promise-based client for executing FHEM commands via FHEMWEB, supporting SSL, Basic Auth and CSRF Token.
 * Uses Node.js http or https module, depending on the protocol specified in the URL.
 *
 * Example:
 *
 * const fhemclient = require('fhem-client');
 * const fhemClient = new fhemclient.FhemClient({ url: 'https://localhost:8083/fhem', username: 'thatsme', password: 'topsecret' });
 *
 * fhemClient.execCmd('set lamp on').then(() => console.log('Succeeded'), e => console.log('Failed:', e));
 * fhemClient.execCmd('get hub currentActivity').then(result => console.log('Current activity:', result), e => console.log('Failed:', e));
 */
class FhemClient
{
	/**
	 * Creates and initialises an instance of FhemClient.
	 * @param {object} options
	 * @param {string} options.url The URL of the desired FHEMWEB instance: 'http[s]://<host>:<port>/webname'
	 * @param {string} options.username Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance
	 * @param {string} options.password Must be supplied if you have enabled Basic Auth for the respective FHEMWEB instance
	 * @param {Logger} [logger] You can pass any logger instance as long as it provides the methods debug(), info(), warn() and error().
	 */
	constructor(options, logger)
	{
		this.logger = logger ? logger : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
		this.fhem   = options;

		this.url    = new URL(options.url);
		this.client = this.url.protocol === 'https:' ? https : http; // Yes, Node.js forces the user to select the appropriate module. // Not putting the ternary if inside one 'require()' for VS Code's type inference to work.

		if (options.username && options.password)
		{
			this.url.username = options.username;
			this.url.password = options.password;
		}

		this.url.searchParams.set('XHR', '1'); // We just want the result of the command, not the whole page.

		this.getOptions = { headers: { Connection: 'keep-alive' }, rejectUnauthorized: false };
	}

	/**
	 * Request FHEMWEB to call a registered module function. This method corresponds to FHEM's Perl function 'CallFn'.
	 * @param {string} name The name of the device to call the function for.
	 * @param {string} functionName The name of the function as used to register it in the module hash.
	 * @param {boolean} [passDevHash] Whether the ref to the instance hash of the device should be passed to the function as first argument.
	 * @param {boolean} [functionReturnsHash] Whether the function returns a hash that should be transformed into a Map.
	 *
	 * If the function returns a hash (literal, no ref), which is just an even-sized list, you must indicate this.
	 * Failing to do so will give you an array of key/value pairs.
	 *
	 * On the other hand, if you provide true for this and the function returns a scalar or an odd-sized list, an exception will be thrown.
	 * @param {...string | number} args The arguments to be passed to the function.
	 * @returns {Promise<string | number | void | (string | number)[] | Map<string | number, string | number>>} A Promise that will be resolved with the result on success
	 * and rejected with the HTTP status code on error.
	 *
	 * If the function cannot be found in the module hash or returns undef, the result will be undefined.
	 *
	 * If the function returns a scalar or a list, the result will be a value or an array, respectively.
	 * Furthermore, if the list is even-sized and functionReturnsHash === true, the result will be a Map.
	 *
	 * In either case, numbers will be returned as numbers, not as strings.
	 */
	callFn(name, functionName, passDevHash, functionReturnsHash, ...args)
	{
		// @ts-ignore
		args = args.map(arg => isNaN(Number(arg)) ? `'${arg}'` : arg).join(',');

		const invocation = passDevHash ? `CallFn('${name}','${functionName}',$defs{${name}},${args})` : `CallFn('${name}','${functionName}',${args})`;

		const code = `use Scalar::Util 'looks_like_number';; my @ret = ${invocation};; !defined($ret[0]) ? 'undef' : ` +
			`'['.join(',', map(looks_like_number($_) ? $_ : '"'.$_.'"', @ret)).']'`;

		return this.execPerlCode(code).then(
			ret => // Either 'undef' or an array in JSON.
			{
				if (ret === 'undef') return;

				// @ts-ignore
				ret = JSON.parse(ret);

				// @ts-ignore
				if (ret.length === 1) return ret[0];

				if (functionReturnsHash)
				{
					// @ts-ignore
					if (ret.length % 2 === 0)
					{
						const map = new Map();

						// @ts-ignore
						for (let i = 0; i < ret.length; i += 2) map.set(ret[i], ret[i + 1]);

						return map;
					}
					else throw new Error('Cannot create a Map from an odd-sized list.');
				}

				return ret;
			}
		);
	}

	/**
	 * Request FHEMWEB to execute Perl code.
	 * @param {string} code A string containing valid Perl code. Be sure to use ';;' to separate multiple statements.
	 * @returns {Promise<string | number>} A Promise that will be resolved with the result in its actual data type on success
	 * and rejected with the HTTP status code on error.
	 */
	execPerlCode(code)
	{
		return this.execCmd(`{ ${code} }`);
	}

	/**
	 * Request FHEMWEB to execute a FHEM command.
	 * @param {string} cmd The FHEM command to execute
	 * @returns {Promise<string | number>} A Promise that will be resolved with the result in its actual data type on success
	 * and rejected with the HTTP status code on error.
	 */
	execCmd(cmd)
	{
		const { logger, url } = this; // '{ a, b, ... } = obj;' is short for 'a = obj.a; b = obj.b; ...'

		logger.info(`Executing FHEM command '${cmd}'...`);

		// No token => Obtain it and call this method again.
		if (!url.searchParams.get('fwcsrf')) return this.obtainCsrfToken().then(
			token =>
			{
				if (token) url.searchParams.set('fwcsrf', token);

				return this.execCmd(cmd);
			},
			status =>
			{
				return Promise.reject(status);
			}
		);

		url.searchParams.set('cmd', cmd);

		let body = '';

		return this.getWithPromise(
			(res, resolve, reject) =>
			{
				switch (res.statusCode)
				{
					case 200:
						res.on('data', chunk => body += chunk);
						res.on('end',
							() =>
							{
								body = body.replace(/\n/, ''); // FHEMWEB appends a newline to the result, remove it.

								logger.debug(`Request succeeded. Response: '${body}'.`);

								// If we got a number, return it as such
								const number = Number(body);
								resolve(isNaN(number) ? body : number);
							}
						);

						break;
					case 400: // No or invalid CSRF token when requesting execution of 'cmd'
						if (url.searchParams.get('fwcsrf'))
						{
							logger.warn('CSRF token no longer valid, updating token and reissuing request.');

							// @ts-ignore
							url.searchParams.set('fwcsrf', res.headers['x-fhem-csrftoken']);

							this.execCmd(cmd).then(
								body => resolve(body),
								status => reject(status)
							);
						}
						else // We didn't get a token, but it is needed.
						{
							logger.error(`Failed to execute FHEM command '${cmd}': Obviously, this FHEMWEB does use a CSRF token, but it doesn't send it.`);

							reject(res.statusCode);
						}

						break;
					case 401: // Authentication error
						logger.error(`Failed to execute FHEM command '${cmd}': Wrong username or password.`);

						reject(res.statusCode);

						break;
					default:
						logger.error(`Failed to execute FHEM command '${cmd}': Status: ${res.statusCode}, message: '${res.statusMessage}'.`);

						reject(res.statusCode);
				}
			}
		);
	}

	/**
	 * [Internal method] Obtains the CSRF token, if any, from FHEMWEB without causing a "FHEMWEB WEB CSRF error".
	 * @returns {Promise<string>} A Promise that will be resolved with the token or an empty string on success
	 * and rejected with the HTTP status code on error.
	 */
	obtainCsrfToken() // Without causing
	{
		const { logger } = this;

		return this.getWithPromise(
			(res, resolve, reject) =>
			{
				let token = res.headers['x-fhem-csrftoken'];
				if (!token) token = '';

				switch (res.statusCode)
				{
					case 400: // No or invalid CSRF token when requesting execution of 'cmd', but we shouldn't have a cmd here.
						logger.warn('Got 400. This should not happen!');
					case 200: // A GET request with correct authentication and without 'cmd' and 'fwcsrf' params gives no error.
						if (token) logger.info('Obtained CSRF token');
						else logger.info("No CSRF token received. Either this FHEMWEB doesn't use it, or it doesn't send it. We will see...");

						resolve(token);

						break;
					case 401: // Authentication error
						logger.error('Failed to get CSRF token: Wrong username or password.');

						reject(res.statusCode);

						break;
					default:
						logger.error(`Failed to get CSRF token: Status: ${res.statusCode}, message: '${res.statusMessage}'.`);

						reject(res.statusCode);
				}
			}
		);
	}

	/**
	 * [Internal method] Wraps a call to this.client.get() in a Promise.
	 * @param {(res: http.IncomingMessage, resolve: (value?: any) => void, reject: (reason?: any) => void) => void} processResponse Called on server response with the
	 * response object, as well as the two functions to resolve or reject the Promise.
	 * @returns {Promise<any>}
	 */
	getWithPromise(processResponse)
	{
		const { logger } = this;

		return new Promise(
			(resolve, reject) =>
			{
				this.client.get(this.url, this.getOptions,
					res =>
					{
						res.on('error',
							e =>
							{
								logger.error('Response error:', e.message);

								// @ts-ignore
								reject(e.code);
							}
						);

						res.on('aborted',
							() =>
							{
								logger.error('Response closed prematurely.');

								reject('aborted');
							}
						);

						res.on('close', () => logger.debug('Connection closed.'));

						processResponse(res, resolve, reject);
					}
				).on('error',
					e =>
					{
						logger.error('Request failed:', e.message);

						// @ts-ignore
						reject(e.code);
					}
				);
			}
		);
	}
}

module.exports = FhemClient;
