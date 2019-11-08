#!/usr/bin/env node

/*
 * tuyadevctlsrv.js
 *
 * Created on: Sep 18, 2019
 * Author    : derkallevombau
 */

// N.B.: - 'for ... of Array' iterates over elements.
//		 - 'for ... in Object' iterates over property names (cf. iterating over hash keys in Perl).
//		 - 'for ... of Object' iterates over property values (cf. iterating over hash values in Perl).
//		 - 'let' scopes variable to block, as opposed to 'var' which scopes to function body.
// N.B.: JS's boolean evaluation of non-boolean expressions works like Perl's:
//		 - undefined, null, '' and 0 are evaluated to false.
//		 - (non-null) references, non-empty strings and numbers !== 0 are evaluated to true.

const TuyAPI = require('tuyapi');
const log4js = require('log4js');
const http = require('http');
const fs = require('fs');
const path = require('path').posix;
const assert = require('assert').strict;

const FhemClient = require("./fhem-client");

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
		default:            { appenders: ['fhemLogs'], level: 'debug' }, // Dummy. Not used, but Log4js complains if not defined
		tuyadevctlsrv_fhem: { appenders: ['stdout', 'myLogs', 'fhemLogs'], level: 'debug' },
		fhem_client:        { appenders: ['stdout', 'myLogs', 'fhemLogs'], level: 'debug' }
	}
};

let logger;

let configFilePath = '.tuyadevctlsrv-fhem/config.json';

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
			username: undefined,
			password: undefined
		},
		devices: []
	}
};

let server;

/**
 * @type FhemClient
 */
let fhemClient;

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
	const opts = new Map(); // Value indicates if opt needs a value.

	opts.set('--server-host', true);
	opts.set('--server-port', true);
	opts.set('--fhem-url', true);
	opts.set('--fhem-user', true);
	opts.set('--fhem-pass', true);
	opts.set('--no-log-stdout', false);
	opts.set('--log-level', true);

	let opt, value;

	for (let arg of process.argv.slice(2))
	{
		if (!opts.has(arg) && opt === undefined)
		{
			console.error('Invalid command line argument:', arg);

			process.exit(1);
		}

		if (!opts.has(arg)) // arg is value for opt
		{
			value = arg;
		}
		else if (opts.get(arg)) // arg is option that needs a value; store opt and process in next iteration.
		{
			opt = arg;

			continue;
		}
		// else arg is options that doesn't need a value

		switch (opt)
		{
			case '--server-host': config.cmdLine.server.host   = value; break;
			case '--server-port': config.cmdLine.server.port   = value; break;
			case '--fhem-url':    config.cmdLine.fhem.url      = value; break;
			case '--fhem-user':   config.cmdLine.fhem.username = value; break;
			case '--fhem-pass':   config.cmdLine.fhem.password = value; break;
			case '--no-log-stdout':
				delete loggerConfig.appenders.stdout;

				// @ts-ignore
				for (let cat of loggerConfig.categories) cat.appenders.shift(); // Well-known friend from Perl, among unshift(), pop() and push() ;)

				break;
			case '--log-level':
				// @ts-ignore
				for (let cat of loggerConfig.categories) cat.level = value;

				break;
		}
	}

	log4js.configure(loggerConfig);

	logger = log4js.getLogger('tuyadevctlsrv_fhem');

	logger.debug('Command line:', process.argv.join(' '));
}

function readConfig()
{
	logger.info(`Reading config data from '${configFilePath}'...`);

	let readSuccess = true;

	try
	{
		config.current = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
	}
	catch (e)
	{
		logger.error(`Error reading config: '${e.message}'; using default config.`);

		// // Copy config.default to config.current (using spread operator on object literal).
		// //
		// config.current = { ...config.default };

		readSuccess = false;
	}

	// Check if config read from file is complete
	if (readSuccess)
		for (let propName in config.default)
		{
			if (!config.current[propName])
			{
				if (propName !== 'devices') logger.error(`Config file doesn't contain ${propName} config, using default.`);

				config.current[propName] = config.default[propName];
			}

			if (config.cmdLine[propName])
			{
				config.current[propName] = config.cmdLine[propName];
			}
		}

	// Command line options take precedence
	for (let propName in config.cmdLine) config.current[propName] = config.cmdLine[propName];

	for (let propName in config.current) if (propName !== 'devices') logger.info(`Using ${propName} config:\n`, config.current[propName]);

	devices = config.current.devices;

	fhemClient = new FhemClient(config.current.fhem, log4js.getLogger('fhem_client'));

	const devNames = devices.map(device => device.name).join(', '); // Two well-known friends from Perl ;)

	logger.info(`We have ${devices.length} devices: ${devNames}.`);
}

function writeConfig()
{
	logger.info(`Writing config data to '${configFilePath}'...`);

	if (!fs.existsSync(path.dirname(configFilePath)))
	{
		const dir = path.dirname(configFilePath);

		logger.info(`Creating dir '${dir}'...`);

		try
		{
			fs.mkdirSync(dir);
		}
		catch (e)
		{
			logger.error(`Error creating dir '${dir}': '${e.message}'; using cwd: '${process.cwd()}'`);

			configFilePath = path.join(process.cwd(), path.basename(configFilePath));
		}
	}

	for (let device of devices) if (device.api) deinitDevice(device);

	try
	{
		fs.writeFileSync(configFilePath, JSON.stringify(config.current, null, 4), 'utf8');
	}
	catch (e)
	{
		logger.error(`Error writing config: '${e.message}'; dumping to log:\n`, config.current);
	}
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
	device.api.on('error', error => onDeviceError(device, error));

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
			error => logger.info(`Error: ${error.message}. Retrying in ${retryInterval} secs...`)
		);

		await sleep(retryInterval);
	}
}

/**
 * Tries to connect to device.
 * @param {Device} device The device to connect.
 * @returns {Promise<void>} A `Promise` that, on error, throws an error with a message to be returned to FHEM TuyaDevice.
 */
function connectDevice(device)
{
	logger.info(`Searching for device '${device.name}'...`);

	return device.api.find().then( // Does this harm when reconnecting? => Test it!
		found =>
		{
			assert(found);

			logger.info(`Connecting to device '${device.name}'...`);

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
	logger.info(`Disconnecting from device '${device.name}'...`);

	if (device.api.isConnected())
	{
		device.api.disconnect();

		logger.info(`Successfully disconnected from device '${device.name}'.`);
	}
	else logger.info(`Device '${device.name}' already disconnected.`);
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
	logger.info(`Defining device '${dev}' of type '${type}' with ${ipOrIdKey}: '${ipOrIdValue}', key: ${key}'.`);

	// Check if we have a device with supplied name.
	// N.B.: Even if we have, it's not in deviceFromName
	// since it has not been initialised yet.

	let device;

	for (device of devices) if (device.name === dev) break;

	if (device && device.type === type && device.tuyapiCtorOpts[ipOrIdKey] === ipOrIdValue && device.tuyapiCtorOpts[key] === key)
	{
		logger.info(`Define device '${dev}': Already defined and up to date.`);
	}
	else if (device) // Update existing device
	{
		if (device.tuyapiCtorOpts[key] !== key) // No idea if device encryption key can change; rather unlikely I think.
		{
			logger.warn(`Define device '${dev}': Updating 'key': '${device.tuyapiCtorOpts.key}' -> '${key}'.`);

			device.tuyapiCtorOpts.key = key;
		}

		if (device.tuyapiCtorOpts[ipOrIdKey] !== ipOrIdValue)
		{
			if (device.tuyapiCtorOpts[ipOrIdKey])
			{
				logger.info(`Define device '${dev}': Updating '${ipOrIdKey}': '${device.tuyapiCtorOpts[ipOrIdKey]}' -> '${ipOrIdValue}'.`);

				device.tuyapiCtorOpts[ipOrIdKey] = ipOrIdValue;
			}
			else if (ipOrIdKey === 'id')
			{
				logger.info(`Define device '${dev}': Deleting 'ip': '${device.tuyapiCtorOpts.ip}', setting 'id': '${ipOrIdValue}'.`);

				delete device.tuyapiCtorOpts.ip;
				device.tuyapiCtorOpts.id = ipOrIdValue;
			}
			else
			{
				logger.info(`Define device '${dev}': Deleting 'id': '${device.tuyapiCtorOpts.id}', setting 'ip': '${ipOrIdValue}'.`);

				delete device.tuyapiCtorOpts.id;
				device.tuyapiCtorOpts.ip = ipOrIdValue;
			}
		}

		if (device.type !== type)
		{
			logger.warn(`Define device '${dev}': Updating 'type': '${device.type}' -> '${type}'.`);

			device.type = type;
		}
	}
	else // We have no device with supplied name
	{
		// Device name could have been changed by editing fhem.cfg instead of using 'rename'
		// => Search for device matching all supplied args except for name.

		let found = false;

		for (device of devices)
			if (device.type === type && device.tuyapiCtorOpts[ipOrIdKey] === ipOrIdValue && device.tuyapiCtorOpts[key] === key)
			{
				logger.warn(`Define device '${dev}': Updating 'name': '${device.name}' -> '${dev}'. Consider using 'rename' instead of editing fhem.cfg.`);

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

			logger.info(`Define device '${dev}': Created new device of type '${type}' with '${ipOrIdKey}': '${ipOrIdValue}' and 'key': '${key}'.`);
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
	logger.info(`Undefining device '${device.name}' of type '${device.type}'.`);

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
	logger.info(`Deleting device '${device.name}' of type '${device.type}'.`);

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
	logger.info(`Renaming device '${device.name}' of type '${device.type}' to '${newName}'.`);

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
	logger.error(`Event from device: '${device.name}': Error:`, error.message);

	fhemClient.callFn(device.name, 'OnError', true);

	if (!device.api)
	{
		logger.info('Device has been undefined, ignoring error.');

		return;
	}

	if (!device.api.isConnected())
	{
		logger.error(`Could not connect to device '${device.name}', retrying...`);

		reconnectDevice(device, 10);
	}
}

/**
 * Handles device connected events.
 * @param {Device} device
 */
function onDeviceConnected(device)
{
	logger.info(`Event from device '${device.name}': Connected.`);

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
		logger.warn(`Event from device '${device.name}': Disconnected, trying to reconnect...`);

		fhemClient.callFn(device.name, 'OnDisconnected', true);

		reconnectDevice(device, 10);
	}
}

/**
 * Initiates calibration procedure for a blind device.
 * @param {Device} device
 * @returns {Promise<void>} A Promise that, on error, throws an error with a message to be returned to FHEM TuyaDevice.
 */
function beginBlindCalibration(device)
{
	blindBeingCalibrated = device;
	blindCalibrationPhase = 0;

	logger.info(`Blind calibration: Opening '${device.name}' completely...`);

	return setDevProp(device, 1, 'open').catch(
		error =>
		{
			blindCalibrationPhase = blindBeingCalibrated = undefined;

			const message = `Blind calibration: Could not open '${device.name}', calibration aborted. Reason: ${error.message}`;

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

				logger.error(message = `Blind calibration: You did not open '${device.name}', calibration aborted.`);
			}
			else logger.info(message = `Blind calibration: '${device.name}' is opening...`);

			break;
		case 1:  // Blind is fully open: Starting point for measuring fullCloseTime.
			if (currValue === 'open') blindCalibrationPhase--; // User hit "Open" again, see 2). Igore that.
			else if (currValue !== 'stop')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: '${device.name}' not stopped, calibration aborted.`);
			}
			else logger.info(message = `Blind calibration: Now close '${device.name}' and stop immediately when it is completely closed.`);

			break;
		case 2:  // Blind is closing...
			if (currValue !== 'close')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: You did not close '${device.name}', calibration aborted.`);
			}
			else logger.info(message = `Blind calibration: '${device.name}' is closing...`);

			break;
		case 3:  // Blind is fully closed: Calculate fullCloseTime; starting point for measuring fullOpenTime.
			if (currValue === 'close') blindCalibrationPhase--; // User hit "Close" again, see 2). Igore that.
			else if (currValue !== 'stop')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: '${device.name}' not stopped, calibration aborted.`);
			}
			else
			{
				newFullCloseTime = currTime - device.defaultPropLastChgTime;

				logger.info(message = `Blind calibration: Now open '${device.name}' and stop immediately when it is completely open.`);
			}

			break;
		case 4:  // Blind is opening...
			if (currValue !== 'open')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: You did not open '${device.name}', calibration aborted.`);
			}
			else logger.info(message = `Blind calibration: '${device.name}' is opening...`);

			break;
		case 5:  // Blind is fully open: Calculate fullOpenTime.
			if (currValue === 'open') blindCalibrationPhase--; // User hit "Open" again, see 2). Igore that.
			else if (currValue !== 'stop')
			{
				blindCalibrationPhase = blindBeingCalibrated = undefined;

				logger.error(message = `Blind calibration: '${device.name}' not stopped, calibration aborted.`);
			}
			else
			{
				newFullOpenTime = currTime - device.defaultPropLastChgTime;

				// @ts-ignore
				if (device.fullCloseTime !== undefined && device.fullOpenTime !== undefined) // Let user choose to accept or discard new calibration
				{
					// @ts-ignore
					logger.info(message = `Blind calibration: '${device.name}': fullCloseTime: New: ${newFullCloseTime} s, current: ${device.fullCloseTime} s; ` +
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
					logger.info(message = `Blind calibration: '${device.name}': fullCloseTime: ${device.fullCloseTime} s, fullOpenTime: ${device.fullOpenTime} s.\n` +
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

				logger.info(message = `Blind calibration: '${device.name}': New calibration applied. Calibration finished successfully.`);
			}
			else // Discard
			{
				logger.info(message = `Blind calibration: '${device.name}': New calibration discarded. Calibration has not been changed.`);
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
	logger.info(`Blind '${device.name}' is at ${Number.parseInt(device.percentage)} %.`);

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
		logger.error(`Device '${device.name}' is not calibrated, please calibrate first.`);

		return Promise.reject();
	}

	logger.error(`Setting blind '${device.name}' to ${percentage} %...`);

	const deltaPerc = percentage - device.percentage;
	const value = deltaPerc > 0 ? 'close' : 'open';
	// @ts-ignore
	const fullTime = value === 'close' ? device.fullCloseTime : -device.fullOpenTime;
	const deltaT = deltaPerc * fullTime / 100;

	function handleError(error)
	{
		const message = `Failed to set percentage for blind '${device}': ${error.message}`;

		logger.error(message);

		throw new Error(message);
	}

	return setDevProp(device, 1, value).then(
		() => sleep(deltaT).then(
			() => setDevProp(device, 1, 'stop').then(
				// @ts-ignore
				() => logger.info(`Successfully set percentage for blind '${device}'. Actual value: ${Number.parseInt(device.percentage)} %`),
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
	logger.debug(`Event from device '${device.name}': Data:`, data);

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
		logger.debug(`Device '${device.name}': Property '${changedPropNameAndValue[0]}' has changed its value to '${changedPropNameAndValue[1]}'`);

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

				// Forward state message FHEM TuyaDevice.
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

function startup()
{
	processCmdLineArgs();
	readConfig();

	const serverConfig = config.current.server;

	server = http.createServer(processHttpRequest);

	server.on('error',
		e =>
		{
			// @ts-ignore
			if (e.code === 'EADDRINUSE') logger.error(`Address '${serverConfig.host}:${serverConfig.port}' already in use.`);
			else logger.error('Server error:', e.message);
		}
	);

	logger.info(`Starting server to listen on ${serverConfig.host}:${serverConfig.port} for HTTP requests...`);

	server.listen(serverConfig, () => logger.info('Successfully started server:', server.address()));

	process.once('SIGINT',
		code =>
		{
			logger.info('SIGINT received.');
			shutdown();
		}
	);

	process.once('SIGTERM',
		code =>
		{
			logger.info('SIGTERM received.');
			shutdown();
		}
	);
}

/**
 * @param {http.ServerResponse} [res]
 */
function shutdown(res)
{
	logger.info('Shutting down server...');

	// When FHEM is shut down, each 'TuyaDevice' instance disconnects its device,
	// but just to be sure...
	for (let device of devices) if (res && device.api.isConnected())
	{
		logger.warn(`Device ${device.name} is still connected, this should not happen!`);

		disconnectDevice(device);
	}

	writeConfig();

	server.close(() => logger.info('Server has been shut down.'));

	log4js.shutdown();

	if (res) respondSuccess(res);
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function processHttpRequest(req, res)
{
	res.writeHead(200, { 'Content-Type': 'text/plain' });

	// Legacy API of URL module

	// const params = url.parse(req.url, true).query;

	// logger.debug(`Parameters from URL: ${JSON.stringify(params)}.`);

	// const deviceName = params.dev;
	// let   cmd        = params.cmd;
	// let   arg        = params.arg;

	// WHATWG API

	const params = (new URL(req.url)).searchParams;

	logger.debug('Parameters from URL:', params);

	// params.get() returns 'null' if not present.

	/**
	 * Name of FHEM TuyaDevice
	 */
	const dev = params.get('dev');

	/**
	 * Without `dev`: server command.
	 *
	 * With `dev`: 'connect', 'undef', 'delete', server-provided device command.
	 *
	 * With `dev` and `arg`: 'define', 'rename'.
	 *
	 * With `dev` and `prop`: 'get'.
	 *
	 * With `dev`, `prop` and `arg`: 'set'.
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
			case 'getState': res.end('running'); return;
			case 'shutdown': shutdown(res); return;
			default:
				invalidRequest(res, `Unknown server command: '${cmd}'`);
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
					invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}']: 'arg' not specified.`);
					return;
				}

				const args = arg.split(','); // Like Perl's 'split()', except that it's called as a method of the string to be splitted.

				if (args.length < 4 || args.length % 2 !== 0 || !args[1].match(/^(?:ip|id)$/))
				{
					invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}', arg: '${arg}']: 'arg' is malformed.`);
					return;
				}

				if (device)
				{
					invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}', arg: '${arg}']: Device already defined.`);
					return;
				}

				const type = args[0];
				const ipOrIdKey = args[1]; // 'ip' or 'id'
				const ipOrIdValue = args[2];
				const key = args[3];

				const propNameFromIdx = new Map();

				for (let i = 4; i < args.length; i += 2)
				{
					const propIdx = Number(args[i]);
					const propName = args[i + 1];

					if (isNaN(propIdx))
					{
						invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}', arg: '${arg}']: '${propIdx}' is not a valid index for property '${propName}'.`);
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
		invalidRequest(res, `[cmd: '${cmd}']: Unknown device '${dev}'.`);
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
				invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}']: 'arg' not specified.`);
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
			deleteDevice(device);

			respondSuccess(res);
			return;
	}

	if (!device.api.isConnected())
	{
		invalidRequest(res, `[cmd: '${cmd}']: Device '${dev}' is currently not connected.`);
		return;
	}

	// We have a device that is connected and a command.

	switch (cmd)
	{
		case 'get':
		case 'set':
			if (!prop)
			{
				invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}']: 'prop' not specified.`);
			}
			else if (cmd === 'set' && !arg)
			{
				invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}', prop: '${prop}']: 'arg' not specified.`);
			}
			else if (!isNaN(Number(prop))) // Native device property
			{
				// @ts-ignore
				prop = Number(prop);

				// @ts-ignore
				if (!device.propNameFromIdx.has(prop))
				{
					invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}']: '${prop}' is not a valid property index.`);
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
							invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}', prop: '${prop}']: Property is valid for blind device only.`);
						}
						// @ts-ignore
						else if (cmd === 'set' && isNaN(arg = Number(arg)) || arg < 0 || arg > 100)
						{
							invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}', prop: '${prop}']: '${arg}' is not a valid percentage.`);
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
				invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}']: Command is valid for blind device only.`);
			}
			else if (blindBeingCalibrated)
			{
				invalidRequest(res, `[cmd: '${cmd}', dev: '${dev}']: Already calibrating device '${blindBeingCalibrated.name}'.`);
			}
			else
			{
				responseFromPromise(res, beginBlindCalibration(device));
			}

			return;
	}

	invalidRequest(res, `'${cmd}' is not a valid command for device '${dev}'.`);
}

/**
 * Sets property with index `propIdx` of `device` to `value`.
 * @param {Device} device
 * @param {number} propIdx
 * @param {string | boolean} value
 * @returns {Promise<void>} A `Promise` that, on error, throws an error with a message to be returned to FHEM TuyaDevice.
 */
function setDevProp(device, propIdx, value)
{
	const propName = device.propNameFromIdx.get(propIdx);

	logger.info(`Setting property '${propName}' of device '${device.name}' to '${value}'...`);

	return device.api.set({ dps: propIdx, set: value }).then(
		response =>
		{
			logger.debug(`Response from device '${device.name}':`, response);

			const currValue = response.dps[propIdx];

			const success =
				device.type === 'blind' && propIdx === 1 && value !== 'stop' // Opening or closing a blind
				&& (device.defaultPropLastValue === 'open' && value === 'close'
					|| device.defaultPropLastValue === 'close' && value === 'open') // Was opened, now closing or vice versa
				&& currValue === 'stop' // Everything is fine: blind stops before moving in the opposite direction.
				|| currValue === value; // In general, on success, the value returned is the value we set.

			if (success)
			{
				logger.info(`Successfully set '${propName}'.`);
			}
			else
			{
				const message = `Failed to set '${propName}': Value '${value}' rejected. Current value: '${currValue}'`;

				logger.error(message);

				throw new Error(message);
			}
		},
		error =>
		{
			const message = `Failed to set '${propName}' to '${value}'`;

			logger.error(message + ':', error.message);

			throw new Error(message + '.');
		}
	);
}

/**
 * Gets value of property with index `propIdx` of `device`.
 * @param {Device} device
 * @param {number} propIdx
 * @returns {Promise<string | boolean>} A `Promise` that contains the value on success
 * or throws an error with a message to be returned to FHEM TuyaDevice.
 */
function getDevProp(device, propIdx)
{
	const propName = device.propNameFromIdx.get(propIdx);

	logger.info(`Getting value of property '${propName}' of device '${device.name}'...`);

	return device.api.get({ dps: propIdx }).then(
		value =>
		{
			logger.info(`Successfully got value of '${propName}': '${value}'.`);

			return value;
		},
		error =>
		{
			const message = `Failed to get value of '${propName}'`;

			logger.error(message + ':', error.message);

			throw new Error(message + '.');
		}
	);
}

/**
 * Toggles boolean property with index `propIdx` of `device`.
 * @param {Device} device
 * @param {number} propIdx
 * @returns {Promise<void>} A `Promise` that, on error, throws an error with a message to be returned to FHEM TuyaDevice.
 */
function toggleDevProp(device, propIdx)
{
	function handleError(error)
	{
		const message = `Failed to toggle value of '${propName}': ${error.message}`;

		logger.error(message);

		throw new Error(message);
	}

	const propName = device.propNameFromIdx.get(propIdx);

	logger.info(`Toggling property '${propName}' of device '${device.name}'...`);

	return getDevProp(device, propIdx).then(
		value => setDevProp(device, propIdx, value).then(
			() => logger.info(`Successfully toggled value of '${propName}'`),
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
		error => res.end(error.message)
	);
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

// Main program

startup();
