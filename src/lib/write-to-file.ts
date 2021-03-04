/**
 * file-io.ts
 * Author: derkallevombau
 * Created: Mar 03, 2021
 */

import { posix as path } from 'path';
import fs = require('fs');

import Logger from 'src/lib/logger-iface';

/**
 * Creates the parent directory of `filePath` if it doesn't already exist
 * and writes `data` to `filePath`. If an error occurs, an error message
 * including `dataDescription` is logged.
 * @param logger - Any logger that provides the usual log methods.
 * @param filePath - Path of file to write to.
 * @param data - Data to write. If it is an object, it will be stringified with an indentation of 4.
 * @param dataDescription - Description of data to be written.
 * @returns `true` on success, `false` on error.
 */
// Record<string, unknown> gives a type mismatch error for an object of an interface type,
// even if the interface's keys are strings.
// Thus, we use a type parameter and 'keyof' - The "Index type query operator" - which yields the union
// of the known, public property names of T.
export default function writeToFile<T>(logger: Logger, filePath: string, data: string | Record<keyof T, unknown>, dataDescription: string): boolean
{
	const dir = path.dirname(filePath);

	logger.info(`Writing ${dataDescription} to ${filePath}...`);

	if (!fs.existsSync(dir))
	{
		logger.info(`Creating dir ${dir}...`);

		try
		{
			fs.mkdirSync(dir, { recursive: true }); // recursive doesn't harm if merely one parent dir has to be created. // What did I mean here?!
		}
		catch (e)
		{
			logger.error(`Cannot write ${dataDescription} to ${filePath}: Error creating dir ${dir}: ${(e as Error).message}.`);

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
		logger.error(`Cannot write ${dataDescription} to ${filePath}: ${(e as Error).message}.`);

		return false;
	}

	return true;
}
