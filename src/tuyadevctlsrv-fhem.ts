#!/usr/bin/env node
//#!/usr/bin/node --inspect-brk=0.0.0.0:9229

/**
 * @file tuyadevctlsrv.js
 * Created on: Sep 18, 2019
 * @author derkallevombau
 */

/*
 * A JS beginner's notes on JS in general and in particular w.r.t. Perl
 *
 * 1) Loops
 *
 *    a) 'for (const e of a: any[])' iterates over array elements.
 *    b) 'for (const i in a: any[])' iterates over array indices (which are actually property names of an array object).
 *    c) 'for (const pn in o: object)' iterates over property names. Cf. Perl: 'for (keys %h)'.
 *    d) 'for (const pv of Object.values(o))' iterates over property values. Cf. Perl: 'for (values %h)'.
 *
 *    Explanation: Although it seems reasonable, 'for (const pv of o: object)' for iterating over property values
 *    works for objects implementing an iterator only, not for sth. like '{a: 1, b: 2 }'.
 *    Instead, we can use 'Object.values(o)' to obtain an array of the object's values, as we do in Perl.
 *
 * 2) Determine type
 *
 *    a) s = 'abc'; typeof s === 'string'; s instanceof String === false (s is a primitive, no object type. Same holds for the following two.)
 *    b) n = 99; typeof n === 'number'
 *    c) b = true; typeof b === 'boolean'
 *    d) o = { a: 1, b: 2 }; typeof o === 'object'; o instanceof Object === true
 *    e) a = [1, 2, 3]; typeof a === 'object' (arrays are objects); a instanceof Array === true
 *    f) r = /./; typeof r === 'object'; r instanceof RegExp === true
 *
 * 3) RegExp with interpolation
 *
 *    In Perl, we can do sth. like 'my $r = qr/^$s$/;' or '<expr> =~ /^$s$/'.
 *    In JS, using the literal form, everything inside /.../ is taken literally, but we can use 'RegExp(pattern: string | RegExp, flags?: string)'
 *    to obtain a RegExp from an interpolated string.
 *
 * 4) Scoping
 *
 *    'let' and 'const' in function body scope variable to respective block, as opposed to older 'var' which scopes to function body.
 *
 * 5) Boolean evaluation
 *
 *    JS's boolean evaluation of non-boolean expressions works like Perl's:
 *
 *    a) undefined, null, '' and 0 are evaluated to false.
 *    b) (non-null) references, non-empty strings and numbers !== 0 are evaluated to true.
 *
 * 6) Merging arrays and objects
 *
 *    a) Merging arrays: [ ...a1, ...a2 ]. Cf. Perl: [ @$a1, @$a2 ] (regarding array refs to emphasise the parallels).
 *       In JS, we need to apply the spread operator to insert the array contents, not the reference.
 *       Similarly, in Perl, we need to dereference the array ref, yielding a (direct) array which can be inserted into a list
 *       like a literal list, and e. g. '[ 1, (1, 2)]' is the same as '[1, 2, 3]'.
 *
 *    b) Merging objects: { ...o1, ...o2 }. Cf. hash in Perl: { %$h1, %$h2 } (again regarding hash refs to emphasise the parallels).
 *       In JS, the spread operator "decomposes" objects as it decomposes arrays.
 *       In Perl, we dereference the hash ref, yielding a (direct) hash which can be inserted into a list
 *       like a literal list, because a literal hash is just an even-sized list.
 *
 * 7) Statics
 *
 *    a) Static (class) variables:
 *
 *       i)  Just use '<class name>.<varname>' instead of 'this.<varname>' as for instance variables:
 *
 *           class A { constructor() { if (A.n === undefined) A.n = 0; A.n++; } getInstanceCount() { return A.n; } }
 *           a1 = new A(); a1.getInstanceCount() // returns 1
 *           a2 = new A(); a2.getInstanceCount() // returns 2
 *           a1.getInstanceCount()               // returns 2
 *
 *       ii) In a more familiar fashion using 'static' keyword, allowing immediate initialisation. Can be used for static (class) methods as well.
 *           class A { static n = 0; constructor() { A.n++; } getInstanceCount() { return A.n; } }
 *
 *    b) Static local variables: Since functions are objects, a) i) can be used. ii) Works for classes only.
 *
 *       function f() { if (f.alreadyCalled) return 'Subsequent call'; f.alreadyCalled = true; return 'First call'; }
 *       f() // returns 'First call'
 *       f() // returns 'Subsequent call'
 *
 */

/**
 * We need this because /usr/bin/env in the shebang
 * causes the process title to be the name of the
 * interpreter, not that of the script.
 */
process.title = 'tuyadevctlsrv-fhem';

const fhemLogLogger = require('./lib/fhemLogLogger');

/**
 * Initially set to fhemLogLogger.
 * Set to log4js logger as soon as log4js has been configured,
 * which is done after command line args have been processed
 * since they can change default logger config.
 * @type log4js.Logger
 */
// @ts-ignore
let logger = fhemLogLogger;

/**
 * @type http.Server
 */
let server;

/**
 * @type FhemClient
 */
let fhemClient;

let tuyaMasterName;

const exitInfoFilePath  = './.tuyadevctlsrv-fhem/exit.info';

process.on('exit', code => logger.info(`Exited with code ${code} (PID: ${process.pid}).`));

process.on('uncaughtException', // Although doc implies, this doesn't cover unhandledRejection.
	(e, origin) =>
	{
		process.exitCode = -1;

		logger.error(`${origin}:`, e);

		shutdown(origin, e.code, e.message);
	}
);

process.on('unhandledRejection',
	(reason/*, promise*/) => // reason is what the Promise has been rejected with.
	{
		process.exitCode = -1;

		logger.error('unhandledRejection:', reason); // reason and promise contain exactly the same message and call trace.

		let code, message;

		if (reason instanceof Error)
		{
			// @ts-ignore
			code    = reason.code;
			message = reason.message;
		}
		else
		{
			code    = undefined;
			message = reason;
		}

		// @ts-ignore
		shutdown('unhandledRejection', code, message);
	}
);

const TuyAPI   = require('tuyapi');
const log4js   = require('log4js');
const http     = require('http');
const fs       = require('fs');
const path     = require('path').posix;
const assert   = require('assert').strict;

const FhemClient = require("fhem-client");
const CmdLineUtil = require("./lib/cmdline-util");

const logPattern = '%d{yyyy-MM-dd hh:mm:ss.SSS} %5.10p %c: %m';

const loggerConfig =
{
	appenders:
	{
		stdout:
		{
			type: 'stdout',
			layout: { type: 'pattern', pattern: `%[${logPattern}%]` }
		},
		fhemLogs:
		{
			type: 'dateFile', filename: './log/tuyadevctlsrv-fhem.log', pattern: '.yyyy-MM',
			alwaysIncludePattern: true, keepFileExt: true,
			layout: { type: 'pattern', pattern: logPattern }
		}
	},
	categories:
	{
		default:            { appenders: ['stdout', 'fhemLogs'], level: 'debug' }, // Dummy. Not used, but Log4js complains if not defined
		tuyadevctlsrv_fhem: { appenders: ['stdout', 'fhemLogs'], level: 'debug' },
		fhem_client:        { appenders: ['stdout', 'fhemLogs'], level: 'debug' }
	}
};

const configFilePath = './.tuyadevctlsrv-fhem/config.json';

const config =
{
	default:
	{
		server:
		{
			host: 'localhost',
			port: 3001
		},
		fhem:
		{
			url: "http://localhost:8083/fhem",
			username: '',
			password: ''
		},
		devices: []
	},
	cmdLine: { server: {}, fhem: {} }
};

/**
 * @typedef {{
 * name: string,
 * type: string,
 * tuyapiCtorOpts: { ip?: string, id?: string, key: string },
 * api: TuyAPI,
 * propNameFromIdx: Map<number, string>,
 * defaultPropLastValue: string | boolean,
 * defaultPropLastChgTime: number,
 * percentage?: number,
 * }} Device
 */

/**
 * Array containing all devices known to the server.
 *
 * A device is added upon a 'define' request and deleted upon a 'delete'
 * request issued by the corresponding FHEM TuyaDevice.
 * @type Device[]
 */
let devices;

/**
 * Defined and initialised devices
 * @type Map<string, Device>
 */
const deviceFromName = new Map();

/**
 * Set to respective device when in blind calibration mode, else undefined.
 * @type Device
 */
let blindBeingCalibrated;

/**
 *  Non-negative int number when in blind calibration mode, else undefined.
 * @type number
 */
let blindCalibrationPhase;

function processCmdLineArgs()
{
	const cmdLineUtil = new CmdLineUtil(
		{ names: '--server-host -H', processValue: value => config.cmdLine.server.host = value },
		{ names: '--server-port -P', processValue: value => config.cmdLine.server.port = value },
		{ names: '--fhem-url -U', processValue: value => config.cmdLine.fhem.url = value },
		{ names: '--fhem-user -u', processValue: value => config.cmdLine.fhem.username = value },
		{ names: '--fhem-pass -p', processValue: value => config.cmdLine.fhem.password = value },
		{
			names: '--no-log-stdout -n',
			action: () =>
			{
				delete loggerConfig.appenders.stdout;

				// Remove stdout appender (first element) from each category.
				for (const cat of Object.values(loggerConfig.categories)) cat.appenders.shift(); // Well-known friend from Perl, among unshift(), pop() and push() ;)
			}
		},
		{
			names: '--log-level -l',
			processValue: value => // Format: '<level>' (applied to all) or '<cat1Name>:<level1>[,<cat2Name>:<level2>]'
			{
				/**
				 * @type Array
				 */
				const values = value.split(',');

				// If multiple sub-args are supplied, each must specify a logger cat and a level.
				if (values.length > 1 && values.findIndex(v => !v.match(':')) !== -1)
				{
					cmdLineUtil.error(`Invalid value for option '--log-level -l': '${value}'.`);
				}

				if (values.length == 1 && !value.match(':')) // Set same level for all cats.
				{
					for (const cat of Object.values(loggerConfig.categories)) cat.level = value;
				}
				else // Set levels individually.
				{
					for (const catNameAndLevel of values.map(v => v.split(':')))
					{
						const catName = catNameAndLevel[0];
						const cat     = loggerConfig.categories[catName];

						if (!cat)
						{
							cmdLineUtil.error(`Invalid logger category: '${catName}'`);
						}

						cat.level = catNameAndLevel[1];
					}
				}
			}
		},
	);

	cmdLineUtil.process();
}

function readConfig()
{
	logger.info(`Reading config data from ${configFilePath}...`);

	let readSuccess = true;

	try
	{
		config.current = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
	}
	catch (e)
	{
		logger.error(`Error reading config: ${e.message}; using default config.`);

		// // Copy config.default to config.current (using spread operator on object literal).
		// //
		// config.current = { ...config.default };

		config.current = config.default;

		readSuccess = false;
	}

	// Check if config read from file is complete and take missing settings from config.default
	if (readSuccess)
		for (const confName in config.default)
		{
			if (confName === 'devices') continue;

			if (!config.current[confName])
			{
				logger.warn(`Config file doesn't contain ${confName} config, using default.`);

				config.current[confName] = config.default[confName];
			}
			else // Check if config.current[confName] is complete
			{
				for (const settingName in config.default[confName])
				{
					if (!config.current[confName][settingName]) // We have no setting for which 0 or '' would be a valid value.
					{
						logger.warn(`Config file doesn't contain ${settingName} setting from ${confName} config, using default.`);

						config.current[confName][settingName] = config.default[confName][settingName];
					}
				}
			}
		}

	// Command line options take precedence
	for (const confName in config.cmdLine)
		for (const settingName in config.cmdLine[confName])
		{
			logger.info(`Permanently using ${confName}.${settingName} = ${config.cmdLine[confName][settingName]} specified via command line.`);

			config.current[confName][settingName] = config.cmdLine[confName][settingName];
		}

	for (const confName in config.current) if (confName !== 'devices') logger.debug(`Using ${confName} config:\n ${JSON.stringify(config.current[confName], null, 4)}`);

	devices = config.current.devices;

	if (devices.length)
	{
		const devDescs = devices.map(
			device =>
			{
				const opts = device.tuyapiCtorOpts;

				return `${device.name} (type: ${device.type}, ${opts.ip ? `IP: ${opts.ip}` : `ID: ${opts.id}`}, key: ${opts.key})`;
			}
		).join('\n'); // Two well-known friends from Perl ;)

		const multi = devices.length > 1;

		logger.debug(`We have ${devices.length} device${multi ? 's': ''}:${multi ? '\n' : ' '}${devDescs}.`);
	}
	else logger.debug('We have no devices.');
}

/**
 * Constructs a TuyaDevice using device.tuyapiCtorOpts
 * and assigns the referene to device.api,
 * adds device to deviceFromName Map
 * and sets TuyaDevice event handlers.
 * @param {Device} device The device to be initialised.
 */
function initDevice(device)
{
	// @ts-ignore
	device.api = new TuyAPI(device.tuyapiCtorOpts);

	deviceFromName.set(device.name, device);

	// Set device error event handler before calling 'find()' or 'connect()'
	// so it can handle exceptions thrown during execution of these functions.
	device.api.on('error', e => onDeviceError(device, e));

	device.api.on('connected', () => onDeviceConnected(device));
	device.api.on('disconnected', () => onDeviceDisconnected(device));
	device.api.on('data', data => onDeviceData(device, data));
}

/**
 * Removes `api` and `propNameFromIdx` properties from `device`
 * and `device` from `deviceFromName` `Map`.
 * @param {Device} device The device to be "deinitialised".
 */
function deinitDevice(device)
{
	// Delete properties we don't want to save.
	delete device.api;
	delete device.propNameFromIdx;

	deviceFromName.delete(device.name);
}

/**
 * Periodically tries to reconnect to a device that has been disconnected.
 * @param {Device} device The device to reconnect to
 * @param {number} retryInterval Time in secs to wait before retrying if connecting fails.
 */
async function reconnectDevice(device, retryInterval)
{
	let connected = false;

	while (!connected)
	{
		await connectDevice(device).then(
			() => connected = true,
			e => logger.info(`Error: ${e.message}. Retrying in ${retryInterval} secs...`)
		);

		await sleep(retryInterval);
	}
}

/**
 * Tries to connect to device.
 * @param {Device} device The device to connect.
 * @returns {Promise<void>} A `Promise` that, on error, will be rejected
 * with an `Error` object containing a message to be returned to FHEM TuyaDevice.
 */
function connectDevice(device)
{
	logger.info(`Searching for device ${device.name}...`);

	return device.api.find().then( // Does this harm when reconnecting? => Test it!
		found =>
		{
			assert(found);

			logger.info(`Connecting to device ${device.name}...`);

			// N.B.: Always return Promises within a Promise chain!
			// This is obvious in case we need the value returned by the innermost
			// 'onfulfilled' or 'onrejected' handler, but besides, failing to return
			// the Promise returned by 'device.api.connect().then(...)' would cause the
			// resulting promise to be resolved when the device has been found; in other
			// words, 'found => {...}' would return before the Promise returned by
			// 'device.api.connect().then(...)' has been resolved or rejected.
			// If all inner Promises are returned, the resulting Promise will be resolved
			// when the innermost Promise has been resolved.
			return device.api.connect().then(
				connected =>
				{
					assert(connected);

					logger.info('Successfully connected.');
				},
				connectErr =>
				{
					const message = 'Failed to connect';

					logger.error(message + ':', connectErr.message);

					throw new Error(message + '.');
				}
			);
		},
		findErr =>
		{
			const message = `Device not found. Please make sure Tuya Smart Life App is CLOSED (not just in background); ` +
				'you can use it again after we are connected to all devices.';

			logger.error(message + '\nMessage from tuyapi:', findErr.message);

			throw new Error(message + '.');
		}
	);
}

/**
 * Disconnects from device.
 * @param {Device} device The device to disconnect from.
 */
function disconnectDevice(device)
{
	logger.info(`Disconnecting from device ${device.name}...`);

	if (device.api.isConnected())
	{
		device.api.disconnect();

		logger.info(`Successfully disconnected from device ${device.name}.`);
	}
	else logger.info(`Device ${device.name} already disconnected.`);
}

/**
 * Creates or updates (not yet initialised) device and initialises it.
 *
 * Called via server request by a FHEM TuyaDevice's DefFn.
 * @param {string} dev name of FHEM TuyaDevice.
 * @param {string} type Device type.
 * @param {string} ipOrIdKey 'ip' or 'id', depending on what has been used to define the device in FHEM.
 * @param {string} ipOrIdValue Either the IP address or the devID of the device.
 * @param {string} key Device encryption key.
 * @returns {Device} The newly created or updated and initialised device.
 */
function defineDevice(dev, type, ipOrIdKey, ipOrIdValue, key)
{
	logger.info(`Defining device ${dev} of type ${type} with ${ipOrIdKey}: ${ipOrIdValue}, key: ${key}.`);

	// Check if we have a device with supplied name.
	// N.B.: Even if we have, it's not in deviceFromName
	// since it has not been initialised yet.

	let device;

	for (device of devices) if (device.name === dev) break;

	if (device && device.type === type && device.tuyapiCtorOpts[ipOrIdKey] === ipOrIdValue && device.tuyapiCtorOpts.key === key)
	{
		logger.info(`Define device ${dev}: Already defined and up to date.`);
	}
	else if (device) // Update existing device
	{
		if (device.tuyapiCtorOpts.key !== key) // No idea if device encryption key can change; rather unlikely I think.
		{
			logger.warn(`Define device ${dev}: Updating key: ${device.tuyapiCtorOpts.key} -> ${key}.`);

			device.tuyapiCtorOpts.key = key;
		}

		if (device.tuyapiCtorOpts[ipOrIdKey] !== ipOrIdValue)
		{
			if (device.tuyapiCtorOpts[ipOrIdKey])
			{
				logger.info(`Define device ${dev}: Updating ${ipOrIdKey}: ${device.tuyapiCtorOpts[ipOrIdKey]} -> ${ipOrIdValue}.`);

				device.tuyapiCtorOpts[ipOrIdKey] = ipOrIdValue;
			}
			else if (ipOrIdKey === 'id')
			{
				logger.info(`Define device ${dev}: Deleting ip: ${device.tuyapiCtorOpts.ip}, setting id: ${ipOrIdValue}.`);

				delete device.tuyapiCtorOpts.ip;
				device.tuyapiCtorOpts.id = ipOrIdValue;
			}
			else
			{
				logger.info(`Define device ${dev}: Deleting id: ${device.tuyapiCtorOpts.id}, setting ip: ${ipOrIdValue}.`);

				delete device.tuyapiCtorOpts.id;
				device.tuyapiCtorOpts.ip = ipOrIdValue;
			}
		}

		if (device.type !== type)
		{
			logger.warn(`Define device ${dev}: Updating type: ${device.type} -> ${type}.`);

			device.type = type;
		}
	}
	else // We have no device with supplied name
	{
		// Device name could have been changed by editing fhem.cfg instead of using 'rename'
		// => Search for device matching all supplied args except for name.

		let found = false;

		for (device of devices)
			if (device.type === type && device.tuyapiCtorOpts[ipOrIdKey] === ipOrIdValue && device.tuyapiCtorOpts.key === key)
			{
				logger.warn(`Define device ${dev}: Updating name: ${device.name} -> ${dev}. Consider using 'rename' instead of editing fhem.cfg.`);

				renameDevice(device, dev);

				found = true;
				break;
			}

		if (!found) // Create new device
		{
			device =
				{
					name: dev,
					type: type,
					tuyapiCtorOpts:
					{
						[ipOrIdKey]: ipOrIdValue, // [] allows us to use "Computed property names".
						key // Short for 'key: key'
					}
				};

			logger.info(`Define device ${dev}: Created new device of type ${type} with ${ipOrIdKey}: ${ipOrIdValue} and key: ${key}.`);
		}
	}

	// @ts-ignore
	initDevice(device);

	// @ts-ignore
	return device;
}

/**
 * Disconnects from device and "deinitialises" it.
 *
 * Called via server request by a FHEM TuyaDevice's UndefFn.
 * @param {Device} device Device to be undefined.
 */
function undefDevice(device)
{
	logger.info(`Undefining device ${device.name} of type ${device.type}.`);

	disconnectDevice(device);
	deinitDevice(device);
}

/**
 * Removes device from devices array.
 *
 * Called via server request by a FHEM TuyaDevice's DeleteFn.
 *
 * N.B.: When issuing FHEM 'delete' command, UndefFn is called
 * prior to DeleteFn, so the device has already been disconnected
 * and "deinitialised"...
 * @param {Device} device Device to be deleted.
 */
function deleteDevice(device)
{
	logger.info(`Deleting device ${device.name} of type ${device.type}.`);

	assert(!device.api); // ... but you never know ;)

	devices.splice(devices.indexOf(device));
}

/**
 * Renames device.
 *
 * Called via server request by a FHEM TuyaDevice's RenameFn.
 * @param {Device} device Device to be renamed.
 * @param {string} newName
 */
function renameDevice(device, newName)
{
	logger.info(`Renaming device ${device.name} of type ${device.type} to ${newName}.`);

	deviceFromName.delete(device.name);
	deviceFromName.set(newName, device);

	device.name = newName;
}

/**
 * Handles device error events.
 * @param {Device} device
 * @param {Error} error
 */
function onDeviceError(device, error)
{
	logger.error(`Event from device ${device.name}: Error:`, error.message);

	fhemClient.callFn(device.name, 'OnError', true);

	if (!device.api)
	{
		logger.info('Device has been undefined, ignoring error.');

		return;
	}

	if (!device.api.isConnected())
	{
		logger.error(`Could not connect to device ${device.name}, retrying...`);

		reconnectDevice(device, 10);
	}
}

/**
 * Handles device connected events.
 * @param {Device} device
 */
function onDeviceConnected(device)
{
	logger.info(`Event from device ${device.name}: Connected.`);

	fhemClient.callFn(device.name, 'OnConnected', true);
}

/**
 * Handles device disconnected events.
 * @param {Device} device
 */
function onDeviceDisconnected(device)
{
	if (device.api) // Ignore if device has been undefined
	{
		logger.warn(`Event from device ${device.name}: Disconnected, trying to reconnect...`);

		fhemClient.callFn(device.name, 'OnDisconnected', true);

		reconnectDevice(device, 10);
	}
}

/**
 * Initiates calibration procedure for a blind device.
 * @param {Device} device
 * @returns {Promise<void>} A `Promise` that, on error, will be rejected
 * with an `Error` object containing a message to be returned to FHEM TuyaDevice.
 */
function beginBlindCalibration(device)
{
	blindBeingCalibrated = device;
	blindCalibrationPhase = 0;

	logger.info(`Blind calibration: Opening ${device.name} completely...`);

	return setDevProp(device, 1, 'open').catch(
		e =>
		{
			blindCalibrationPhase = blindBeingCalibrated = undefined;

			const message = `Blind calibration: Could not open ${device.name}, calibration aborted. Reason: ${e.message}`;

			logger.error(message);

			throw new Error(message);
		}
	);
}

/**
 * Measures and updates `fullCloseTime` and `fullOpenTime`
 * and initialises `percentage` of `device` in multiple steps.
 *
 * Must be called each time the default property of `device`
 * changes as long as `blindBeingCalibrated === device`.
 * @param {Device} device
 * @param {string} currValue of default property.
 * @param {number} currTime
 * @returns {string} State message for FHEM TuyaDevice.
 */
function blindCalibrationProgress(device, currValue, currTime)
{
	// N.B.: Possible changes of default property:
	//		 1) open | close <-> stop
	//		 2) open -> open, close -> close
	// While 1) is pretty reasonable, 2) is somewhat odd
	// and needs special treatment to prevent it from
	// messing up the calibration process and time measurements.

	let newFullCloseTime, newFullOpenTime;
	let message;

	switch (blindCalibrationPhase++)
	{
		case 0:  // Begin: Blind is opening...
			if (currValue !== 'open')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: You did not open ${device.name}, calibration aborted.`);
			}
			else logger.info(message = `Blind calibration: ${device.name} is opening...`);

			break;
		case 1:  // Blind is fully open: Starting point for measuring fullCloseTime.
			if (currValue === 'open') blindCalibrationPhase--; // User hit "Open" again, see 2). Igore that.
			else if (currValue !== 'stop')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: ${device.name} not stopped, calibration aborted.`);
			}
			else logger.info(message = `Blind calibration: Now close ${device.name} and stop immediately when it is completely closed.`);

			break;
		case 2:  // Blind is closing...
			if (currValue !== 'close')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: You did not close ${device.name}, calibration aborted.`);
			}
			else logger.info(message = `Blind calibration: ${device.name} is closing...`);

			break;
		case 3:  // Blind is fully closed: Calculate fullCloseTime; starting point for measuring fullOpenTime.
			if (currValue === 'close') blindCalibrationPhase--; // User hit "Close" again, see 2). Igore that.
			else if (currValue !== 'stop')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: ${device.name} not stopped, calibration aborted.`);
			}
			else
			{
				newFullCloseTime = currTime - device.defaultPropLastChgTime;

				logger.info(message = `Blind calibration: Now open ${device.name} and stop immediately when it is completely open.`);
			}

			break;
		case 4:  // Blind is opening...
			if (currValue !== 'open')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: You did not open ${device.name}, calibration aborted.`);
			}
			else logger.info(message = `Blind calibration: ${device.name} is opening...`);

			break;
		case 5:  // Blind is fully open: Calculate fullOpenTime.
			if (currValue === 'open') blindCalibrationPhase--; // User hit "Open" again, see 2). Igore that.
			else if (currValue !== 'stop')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: ${device.name} not stopped, calibration aborted.`);
			}
			else
			{
				newFullOpenTime = currTime - device.defaultPropLastChgTime;

				// @ts-ignore
				if (device.fullCloseTime !== undefined && device.fullOpenTime !== undefined) // Let user choose to accept or discard new calibration
				{
					// @ts-ignore
					logger.info(message = `Blind calibration: ${device.name}: fullCloseTime: New: ${newFullCloseTime} s, current: ${device.fullCloseTime} s; ` +
						// @ts-ignore
						`fullOpenTime: New: ${newFullOpenTime} s, current: ${device.fullOpenTime} s.\n` +
						'Press "Open" to apply the new calibration. To keep the current calibration, press "Close".');
				}
				else // Not calibrated yet, apply calibration.
				{
					blindCalibrationPhase = blindBeingCalibrated = undefined;

					// @ts-ignore
					device.fullCloseTime = newFullCloseTime;
					// @ts-ignore
					device.fullOpenTime = newFullOpenTime;
					device.percentage = 0;                // Initialise percentage; 0% means fully open.

					// @ts-ignore
					logger.info(message = `Blind calibration: ${device.name}: fullCloseTime: ${device.fullCloseTime} s, fullOpenTime: ${device.fullOpenTime} s.\n` +
						'Calibration finished successfully.');
				}
			}

			break;
		case 6: // Accept/discard new calibration (only if already calibrated)
			if (currValue === 'open') // Accept
			{
				// @ts-ignore
				device.fullCloseTime = newFullCloseTime;
				// @ts-ignore
				device.fullOpenTime = newFullOpenTime;
				device.percentage = 0;                // Initialise percentage; 0% means fully open.

				logger.info(message = `Blind calibration: ${device.name}: New calibration applied. Calibration finished successfully.`);
			}
			else // Discard
			{
				logger.info(message = `Blind calibration: ${device.name}: New calibration discarded. Calibration has not been changed.`);
			}
	}

	return message;
}

/**
 *
 * @param {Device} device
 * @param {number} currTime
 */
function updateBlindPercentage(device, currTime)
{
	const deltaT = currTime - device.defaultPropLastChgTime;
	// @ts-ignore
	const fullTime = device.defaultPropLastValue === 'close' ? device.fullCloseTime : -device.fullOpenTime;

	device.percentage += 100 * deltaT / fullTime;

	// If user opens blind without stopping it manually,
	// we don't receive the 'stop' event when it is fully open,
	// but when the device switches to 'stop' after a certain
	// amount of time, so we measure a deltaT > device.fullOpenTime,
	// resulting in a percentage < 0. Analogously for closing.
	// Thus, we correct the percentage as appropriate.
	if (device.percentage < 0) device.percentage = 0;
	else if (device.percentage > 100) device.percentage = 100;

	// @ts-ignore
	logger.info(`Blind ${device.name} is at ${Number.parseInt(device.percentage)} %.`);

	// Notify corresponding FHEM TuyaDevice of changed server-supplied device property.
	// @ts-ignore
	fhemClient.callFn(device.name, 'OnPropChanged', true, false, 'Percentage', Number.parseInt(device.percentage));
}

/**
 *
 * @param {Device} device
 * @param {number} percentage
 */
function setBlindPercentage(device, percentage)
{
	if (!device.percentage)
	{
		logger.error(`Blind ${device.name} is not calibrated, please calibrate first.`);

		return Promise.reject();
	}

	logger.error(`Setting blind ${device.name} to ${percentage} %...`);

	const deltaPerc = percentage - device.percentage;
	const value = deltaPerc > 0 ? 'close' : 'open';
	// @ts-ignore
	const fullTime = value === 'close' ? device.fullCloseTime : -device.fullOpenTime;
	const deltaT = deltaPerc * fullTime / 100;

	function handleError(e)
	{
		const message = `Failed to set percentage for blind ${device}: ${e.message}`;

		logger.error(message);

		throw new Error(message);
	}

	return setDevProp(device, 1, value).then(
		() => sleep(deltaT).then(
			() => setDevProp(device, 1, 'stop').then(
				// @ts-ignore
				() => logger.info(`Successfully set percentage for blind ${device}. Actual value: ${Number.parseInt(device.percentage)} %`),
				stopErr => handleError(stopErr)
			)
		),
		startErr => handleError(startErr)
	);
}

/**
 *
 * @param {Device} device
 * @param {*} data
 */
function onDeviceData(device, data)
{
	logger.debug(`Event from device ${device.name}: Data:`, data);

	let dpsAsArray = Object.entries(data.dps);

	// When a device property has changed, this handler is called with
	// data.dps = { <index of changed property>: <new value> }.
	// However, when we change a property via Tuyapi, this handler
	// is called twice, where the first call gives us a data.dps
	// containing all properties with their values _before_ the change,
	// so we proceed only if data.dps contains merely one property.
	if (dpsAsArray.length !== 1) return;

	const changedPropNameAndValue = [device.propNameFromIdx.get(Number(dpsAsArray[0][0])), dpsAsArray[0][1]];

	if (!blindBeingCalibrated) // Suppress this when calibrating a blind since calibration prints its own messages.
		logger.debug(`Device ${device.name}: Property ${changedPropNameAndValue[0]} has changed its value to ${changedPropNameAndValue[1]}`);

	// Notify corresponding FHEM TuyaDevice of changed native device property.
	fhemClient.callFn(device.name, 'OnPropChanged', true, false, ...changedPropNameAndValue);

	// From here, we are only interested in changes of the default property.
	if (data.dps['1'] === undefined) return;

	const currValue = data.dps['1'];
	const currTime = data.t ? data.t : Date.now();

	switch (device.type)
	{
		case 'blind':
			if (blindBeingCalibrated === device)
			{
				const message = blindCalibrationProgress(device, currValue, currTime);

				// Forward state message to FHEM TuyaDevice.
				fhemClient.callFn(device.name, 'OnMessage', true, false, message);
			}

			// Update percentage if blind calibrated. 'stop' cannot be followed by 'stop', but just to be sure...
			if (currValue === 'stop' && device.defaultPropLastValue !== 'stop' && device.percentage !== undefined)
			{
				updateBlindPercentage(device, currTime);

				// Notify corresponding FHEM TuyaDevice of changed server-provided device property.
				// @ts-ignore
				fhemClient.callFn(device.name, 'OnPropChanged', true, false, 'percentage', Number.parseInt(device.percentage));
			}
	}

	if (device.defaultPropLastValue !== currValue) // See 2) in the comment within blindCalibrationProgress().
	{
		device.defaultPropLastValue = currValue;
		device.defaultPropLastChgTime = currTime;
	}
}

async function startup()
{
	processCmdLineArgs();

	log4js.configure(loggerConfig);
	logger = log4js.getLogger('tuyadevctlsrv_fhem');

	logger.debug(`Command line: ${process.argv.join(' ')}, PID: ${process.pid}`);

	logger.debug(`Using logger config:\n ${JSON.stringify(loggerConfig, null, 4)}`);

	readConfig();

	fhemClient = new FhemClient({ ...config.current.fhem, getOptions: { timeout: 5000 } }, log4js.getLogger('fhem_client'));

	// I like the promise chaining pattern, but using 'await' here looks much cleaner
	// than putting the following statements that need tuyaMasterName in '.then(tuyaMasterName => { ... });'.
	tuyaMasterName = await fhemClient.execPerlCode('$modules{TuyaMaster}{defptr}{NAME}');

	const serverConfig = config.current.server;

	server = http.createServer(processHttpRequest);

	server.on('error',
		e =>
		{
			// @ts-ignore
			if (e.code === 'EADDRINUSE')
			{
				logger.fatal(e.message = `Cannot start HTTP server: Address ${serverConfig.host}:${serverConfig.port} already in use.`);
			}
			else
			{

				// @ts-ignore
				logger.error(e.message = `HTTP server error: Code: ${e.code}, message: ${e.message}`);
			}

			throw e;
		}
	);

	logger.info(`Starting HTTP server to listen on ${serverConfig.host}:${serverConfig.port} for HTTP requests...`);

	server.listen(serverConfig,
		() =>
		{
			logger.info('Successfully started HTTP server:', server.address());

			// @ts-ignore
			fhemClient.callFn(tuyaMasterName, 'OnServerRunning', true, false, process.pid);
		}
	);

	function handleSignal(signal)
	{
		logger.info(`${signal} received.`);

		if (signal.match(/^(?:SIGINT|SIGTERM)$/))
		{
			shutdown(signal); // FHEM TuyaMaster "kills" us via SIGTERM or SIGINT.
		}
	}

	process.on('SIGINT', handleSignal);
	process.on('SIGTERM', handleSignal);
}

/**
 * Shutdown the application, notifying FHEM TuyaMaster.
 * @param {string} origin 'SIGTERM' or 'SIGINT' in case of regular shutdown
 * by FHEM TuyaMaster, where SIGTERM indicates we are supposed to callFn OnServerExit
 * if possible, wile SIGINT indicates we shall write to exitInfoFilePath. One of
 * 'uncaughtException' or 'unhandledRejection' in case of error.
 * @param {string} [code] Error code in case of error, if supplied.
 * @param {string} [message] Error message in case of error.
 */
function shutdown(origin, code, message)
{
	// @ts-ignore
	if (shutdown.called)
	{
		switch (origin)
		{
			case 'SIGINT':
			case 'SIGTERM':
				logger.warn('Already shutting down...'); // Should not happen.
				return;
			default: // Called by error handler after first call, so error must have occurred here. Return to avoid endless recursion.
				logger.error('Another error occurred during shutdown.');
				return;
		}
	}

	// @ts-ignore
	shutdown.called = true;

	if (process.exitCode === undefined) process.exitCode = 0;

	logger.info('Shutting down...');

	if (devices) for (const device of devices) if (device.api)
	{
		if (device.api.isConnected()) disconnectDevice(device);

		deinitDevice(device);
	}

	if (config.current) writeToFile(configFilePath, config.current, 'config data');

	function lastStep(origin, code, message)
	{
		// Notify FHEM TuyaMaster of immiment exit.

		if (origin !== 'SIGINT' && fhemClient && tuyaMasterName && !code.match(/EFHEMCL_(?:RES|ABRT|TIMEDOUT|CONNREFUSED|NETUNREACH|CONNRESET|REQ|AUTH|WEBN|NOTOKEN)/))
		{
			fhemClient.callFn(tuyaMasterName, 'OnServerExit', true, false, process.exitCode, origin, code, message);
		}
		else
		{
			writeToFile(exitInfoFilePath, `${process.exitCode}\n${origin}\n${code}\n${message}`, 'exit info');
		}

		logger.info(`Exiting with code ${process.exitCode}.`);

		// @ts-ignore
		if (logger !== fhemLogLogger)
		{
			log4js.shutdown(e => { if (e) fhemLogLogger.error(e); });

			// @ts-ignore
			logger = fhemLogLogger;
		}
	}

	if (server && server.listening)
	{
		logger.debug('Closing HTTP server...');

		server.close(
			e =>
			{
				if (e)
				{
					// @ts-ignore
					logger.error(`Error closing HTTP server: Code: ${e.code}, message: ${e.message}`);
				}

				logger.debug('HTTP server has been closed.');

				lastStep(origin, code, message);
			}
		);
	}
	else lastStep(origin, code, message);
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function processHttpRequest(req, res)
{
	/**
	 * Responds with string 'succ'.
	 * @param {http.ServerResponse} res
	 */
	function respondSuccess(res)
	{
		res.end('succ');
	}

	/**
	 * Waits for `promise` to be resolved or rejected and responds
	 * with string from `promise` if present, else with 'succ' on success
	 * or with error message from `promise` on error.
	 * @param {http.ServerResponse} res
	 * @param {Promise<string | void>} promise
	 */
	function responseFromPromise(res, promise)
	{
		promise.then(
			result => result !== undefined ? res.end(result) : respondSuccess(res),
			e => res.end(e.message)
		);
	}

	res.writeHead(200, { 'Content-Type': 'text/plain' });

	// Legacy API of URL module

	// const params = url.parse(req.url, true).query;

	// logger.debug(`Parameters from URL: ${JSON.stringify(params)}.`);

	// const deviceName = params.dev;
	// let   cmd        = params.cmd;
	// let   arg        = params.arg;

	// WHATWG API

	// req.url is the part after the hostname. The URL ctor needs a full URL,
	// but the hostname is completely irrelevant since we are only interested in searchParams.
	const params = new URL('http://foo.bar' + req.url).searchParams;

	logger.debug('Parameters from URL:', params);

	// params.get() returns 'null' if not present.

	/**
	 * Name of FHEM TuyaDevice
	 */
	const dev = params.get('dev');

	/**
	 * Without `dev`: server command.
	 *
	 * With `dev`: 'connect'(\*), 'undef'(\*), 'delete'(\*), server-provided device command(\*\*).
	 *
	 * With `dev` and `arg`: 'define', 'rename'(\*).
	 *
	 * With `dev` and `prop`: 'get'(\*\*).
	 *
	 * With `dev`, `prop` and `arg`: 'set'(\*\*).
	 *
	 * (\*) Device must be defined and initialised, (\*\*) Device must be connected.
	 */
	const cmd = params.get('cmd');

	/**
	 * With `dev` and `cmd === 'set' || cmd === 'get'`: Index of native or name of server-provided device property to be set or queried.
	 */
	let prop = params.get('prop');

	/**
	 * With `dev` and `cmd === 'define'`: '<type>,ip|id,<ip>|<id>,<key>[,prop1Idx,prop1Name[,prop2Idx,prop2Name]...]'.
	 *
	 * With `dev` and `cmd === 'rename'`: New name.
	 *
	 * With `dev`, `cmd === 'set'` and `prop`: String property: Value to set property to. Bool property: 'on', 'off', 'toggle'
	 */
	let arg = params.get('arg');

	if (!cmd)
	{
		invalidRequest(res, "No command specified.");
		return;
	}

	if (!dev) switch (cmd) // Server command
	{
		case 'test':	 res.end('succ'); return;
		default:
			invalidRequest(res, `Unknown server command: ${cmd}`);
			return;
	}

	const device = deviceFromName.get(dev);

	// We have a device name and a command.

	switch (cmd)
	{
		case 'define': // Issued from within a FHEM TuyaDevice's DefFn.
			{
				if (!arg)
				{
					invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}]: 'arg' not specified.`);
					return;
				}

				const args = arg.split(','); // Like Perl's 'split()', except that it's called as a method of the string to be splitted.

				if (args.length < 4 || args.length % 2 !== 0 || !args[1].match(/^(?:ip|id)$/))
				{
					invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}, arg: ${arg}]: 'arg' is malformed.`);
					return;
				}

				if (device)
				{
					invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}, arg: ${arg}]: Device already defined.`);
					return;
				}

				const type        = args[0];
				const ipOrIdKey   = args[1]; // 'ip' or 'id'
				const ipOrIdValue = args[2];
				const key         = args[3];

				const propNameFromIdx = new Map();

				for (let i = 4; i < args.length; i += 2)
				{
					const propIdx  = Number(args[i]);
					const propName = args[i + 1];

					if (isNaN(propIdx))
					{
						invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}, arg: ${arg}]: '${propIdx}' is not a valid index for property ${propName}.`);
						return;
					}

					propNameFromIdx.set(propIdx, propName);
				}

				defineDevice(dev, type, ipOrIdKey, ipOrIdValue, key).propNameFromIdx = propNameFromIdx;

				respondSuccess(res);
				return;
			}
	}

	if (!device)
	{
		invalidRequest(res, `[cmd: ${cmd}]: Unknown device '${dev}'.`);
		return;
	}

	// We have a device that is defined and initialised and a command.

	switch (cmd)
	{
		case 'connect':
			responseFromPromise(res, connectDevice(device));
			return;
		case 'rename': // Issued from within a FHEM TuyaDevice's RenameFn.
			if (!arg)
			{
				invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}]: 'arg' not specified.`);
			}
			else
			{
				renameDevice(device, arg);

				respondSuccess(res);
			}

			return;
		case 'undef': // Issued from within a FHEM TuyaDevice's UndefFn.
			undefDevice(device);

			respondSuccess(res);
			return;
		case 'delete':  // Issued from within a FHEM TuyaDevice's DeleteFn.
			// deleteDevice(device);

			respondSuccess(res);
			return;
	}

	if (!device.api.isConnected())
	{
		invalidRequest(res, `[cmd: ${cmd}]: Device ${dev} is currently not connected.`);
		return;
	}

	// We have a device that is connected and a command.

	switch (cmd)
	{
		case 'get':
		case 'set':
			if (!prop)
			{
				invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}]: 'prop' not specified.`);
			}
			else if (cmd === 'set' && !arg)
			{
				invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}, prop: ${prop}]: 'arg' not specified.`);
			}
			else if (!isNaN(Number(prop))) // Native device property
			{
				// @ts-ignore
				prop = Number(prop);

				// @ts-ignore
				if (!device.propNameFromIdx.has(prop))
				{
					invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}]: '${prop}' is not a valid property index.`);
				}
				else
				{
					if (cmd === 'get')
					{
						responseFromPromise(res,
							// @ts-ignore
							getDevProp(device, prop).then(
								value =>
								{
									if (value === true) return 'on';
									if (value === false) return 'off';
									return value;
								}
							)
						);
					}
					else // set
					{
						if (arg === 'toggle')
						{
							// @ts-ignore
							responseFromPromise(res, toggleDevProp(device, prop));
						}
						else
						{
							// @ts-ignore
							if (arg === 'on') arg = true;
							// @ts-ignore
							else if (arg === 'off') arg = false;

							// @ts-ignore
							responseFromPromise(res, setDevProp(device, prop, arg));
						}
					}
				}
			}
			else // Server-provided device property
			{
				switch (prop)
				{
					case 'percentage':
						if (device.type !== 'blind')
						{
							invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}, prop: ${prop}]: Property is valid for blind device only.`);
						}
						// @ts-ignore
						else if (cmd === 'set' && isNaN(arg = Number(arg)) || arg < 0 || arg > 100)
						{
							invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}, prop: ${prop}]: '${arg}' is not a valid percentage.`);
						}
						else
						{
							if (cmd === 'get')
							{
								// @ts-ignore
								res.end(Number.parseInt(device.percentage));
							}
							// @ts-ignore
							responseFromPromise(res, setBlindPercentage(device, arg));
						}
				}
			}

			return;
		// Server-provided device command
		case 'calibrate':
			if (device.type !== 'blind')
			{
				invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}]: Command is valid for blind device only.`);
			}
			else if (blindBeingCalibrated)
			{
				invalidRequest(res, `[cmd: ${cmd}, dev: ${dev}]: Already calibrating device ${blindBeingCalibrated.name}.`);
			}
			else
			{
				responseFromPromise(res, beginBlindCalibration(device));
			}

			return;
	}

	invalidRequest(res, `'${cmd}' is not a valid command for device ${dev}.`);
}

/**
 * Gets value of property with index `propIdx` of `device`.
 * @param {Device} device
 * @param {number} propIdx
 * @returns {Promise<string | boolean>} A `Promise` that will be resolved
 * with the value on success or rejected with an `Error` object containing
 * a message to be returned to FHEM TuyaDevice.
 */
function getDevProp(device, propIdx)
{
	const propName = device.propNameFromIdx.get(propIdx);

	logger.info(`Querying value of property ${propName} of device ${device.name}...`);

	return device.api.get({ dps: propIdx }).then(
		value =>
		{
			logger.info(`Successfully queried value of ${propName}: ${value}.`);

			return value;
		},
		e =>
		{
			const message = `Failed to get value of ${propName}: ${e.message}`;

			logger.error(message);
			throw new Error(message);
		}
	);
}

/**
 * Sets property with index `propIdx` of `device` to `value`.
 * @param {Device} device
 * @param {number} propIdx
 * @param {string | boolean} value
 * @returns {Promise<void>} A `Promise` that, on error, will be rejected
 * with an `Error` object containing a message to be returned to FHEM TuyaDevice.
 */
function setDevProp(device, propIdx, value)
{
	const propName = device.propNameFromIdx.get(propIdx);

	logger.info(`Setting property ${propName} of device ${device.name} to ${value}...`);

	return device.api.set({ dps: propIdx, set: value }).then(
		response =>
		{
			logger.debug(`Response from device ${device.name}:`, response);

			const currValue = response.dps[propIdx];

			const success =
				device.type === 'blind' && propIdx === 1 && value !== 'stop' // Opening or closing a blind
				&& (device.defaultPropLastValue === 'open' && value === 'close'
					|| device.defaultPropLastValue === 'close' && value === 'open') // Was opened, now closing or vice versa
				&& currValue === 'stop' // Everything is fine: blind stops before moving in the opposite direction.
				|| currValue === value; // In general, on success, the value returned is the value we set.

			if (success)
			{
				logger.debug(`Successfully set ${propName}.`);
			}
			else
			{
				const message = `Failed to set ${propName}: Value ${value} rejected. Current value: ${currValue}.`;

				logger.error(message);
				throw new Error(message);
			}
		},
		e =>
		{
			const message = `Failed to set ${propName} to ${value}: ${e.message}`;

			logger.error(message);
			throw new Error(message);
		}
	);
}

/**
 * Toggles boolean property with index `propIdx` of `device`.
 * @param {Device} device
 * @param {number} propIdx
 * @returns {Promise<void>} A `Promise` that, on error, will be rejected with an `Error` object
 * containing a message to be returned to FHEM TuyaDevice.
 */
function toggleDevProp(device, propIdx)
{
	const propName = device.propNameFromIdx.get(propIdx);

	function handleError(e)
	{
		const message = `Failed to toggle value of ${propName}: ${e.message}`;

		logger.error(message);
		throw new Error(message);
	}

	logger.info(`Toggling property ${propName} of device ${device.name}...`);

	return getDevProp(device, propIdx).then(
		value => setDevProp(device, propIdx, !value).then(
			() => logger.info(`Successfully toggled value of ${propName}.`),
			setErr => handleError(setErr)
		),
		getErr => handleError(getErr)
	);
}

/**
 * @param {http.ServerResponse} res
 * @param {string} message
 */
function invalidRequest(res, message)
{
	message = 'Invalid request: ' + message;

	logger.error(message);
	res.end(message);
}

/**
 * Returns a `promise` that will be resolved after `secs` seconds.
 * @param {number} secs
 * @returns {Promise<void>}
 */
function sleep(secs)
{
	return new Promise(resolve => setTimeout(resolve, secs * 1000));
}

/**
 * Creates the parent directory of `filePath` if it doesn't already exist
 * and writes `data` to `filePath`. If an error occurs, an error message
 * including `dataDescription` is logged.
 * @param {String} filePath
 * @param {any} data If an object is supplied here, it will be stringified.
 * @param {String} dataDescription
 */
function writeToFile(filePath, data, dataDescription)
{
	const dir = path.dirname(filePath);

	logger.info(`Writing ${dataDescription} to ${filePath}...`);

	if (!fs.existsSync(dir))
	{
		logger.info(`Creating dir ${dir}...`);

		try
		{
			fs.mkdirSync(dir, { recursive: true }); // recursive doesn't harm if merely one parent dir has to be created.
		}
		catch (e)
		{
			logger.error(`Cannot write ${dataDescription} to ${filePath}: Error creating dir ${dir}: ${e.message}.`);

			return false;
		}
	}

	if (data instanceof Object) data = JSON.stringify(data, null, 4);

	try
	{
		fs.writeFileSync(filePath, data, 'utf8');
	}
	catch (e)
	{
		logger.error(`Cannot write ${dataDescription} to ${filePath}: ${e.message}.`);

		return false;
	}

	return true;
}

// Main program

startup();
