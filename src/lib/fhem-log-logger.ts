/**
 * fhem-log-logger.ts
 * Author: derkallevombau
 * Created: Nov 24 2019
 */

// For strftime
/* eslint-disable @typescript-eslint/no-unsafe-call */

import strftime = require('strftime');

/**
 * Logger for first stage of application startup.
 * Since `console` outputs to stdout/stderr and these
 * are redirected to FHEM log, it uses the same formatting.
 */
export default class FhemLogLogger
{
	static debug(message: any, ...optionalParams: any[]): void { console.debug(strftime('%Y.%m.%d %H:%M:%S'), '4:', 'tuyadevctlsrv-fhem:', message, ...optionalParams); }
	static info(message: any, ...optionalParams: any[]): void  { console.info(strftime('%Y.%m.%d %H:%M:%S'), '3:', 'tuyadevctlsrv-fhem:', message, ...optionalParams); }
	static warn(message: any, ...optionalParams: any[]): void  { console.warn(strftime('%Y.%m.%d %H:%M:%S'), '2:', 'tuyadevctlsrv-fhem:', message, ...optionalParams); }
	static error(message: any, ...optionalParams: any[]): void { console.error(strftime('%Y.%m.%d %H:%M:%S'), '1:', 'tuyadevctlsrv-fhem:', message, ...optionalParams); }
	static fatal(message: any, ...optionalParams: any[]): void { console.error(strftime('%Y.%m.%d %H:%M:%S'), '1:', 'tuyadevctlsrv-fhem:', message, ...optionalParams); }

	// N.B.: - Using "String literal types" available since TS 4.1.
	//       - We can access static class mebers via subscript operator like with "legacy" objects, even from inside the class.
	static log(level: 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: any, ...optionalParams: any[]): void { FhemLogLogger[level](message, ...optionalParams); }
}
