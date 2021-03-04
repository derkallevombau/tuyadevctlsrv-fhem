/**
 * logger-iface.ts
 * Author: derkallevombau
 * Created: Mar 03, 2021
 */

/* eslint-disable tsdoc/syntax */

/** @ignore */
type LogMethod = (level: string, ...args: any[]) => void;
/** @ignore */
type LoggerLevelMethod = (message: any, ...args: any[]) => void;

/** @ignore */
export default interface Logger
{
	log  : LogMethod;
	debug: LoggerLevelMethod;
	info : LoggerLevelMethod;
	warn : LoggerLevelMethod;
	error: LoggerLevelMethod;
	fatal: LoggerLevelMethod;
}
