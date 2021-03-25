/*
* error-with-code.ts
* Author: derkallevombau
* Created: Mar 25, 2021
*/

/* eslint-disable tsdoc/syntax */

export interface ErrorOptions
{
	/**
	 * The code to be used for all invocations of `error(message: string)`.
	 */
	code?: string;

	/**
	 * A string to be prepended to the message supplied
	 * to `error(message: string)` and `error(message: string, code: string)`.
	 */
	messagePrefix?: string;
}

/**
 * Sets options for `error(message: string)` and `error(message: string, code: string)`.\
 * @param options -
 */
export default function error(options: ErrorOptions): void;

/**
 * Throws an `Error` object constructed
 * with `message` and `code` property set to provided code.
 * @param message - Error message
 * @param code - Error code
 */
export default function error(message: string, code: string): void;

/**
 * Throws an `Error` object constructed
 * with `message` and `code` property set to code
 * defined via `error({ code: <code> })`.
 * @param message - Error message
 */
export default function error(message: string): void;

export default function error(...args: (ErrorOptions | string)[]): void
{
	switch (args.length)
	{
		case 1: // Ctor 1 or 3
			if (typeof args[0] === 'string') // Ctor 3
			{
				// Cool: Type guards work with expressions like 'args[0]' too,
				// i. e. message has type string.
				let message = args[0];

				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				if (this.messagePrefix) message = this.messagePrefix as string + ' ' + message;

				const e = new Error(message);

				// Solution from StackOverflow to access a non-existing property like in JS.
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
				if (this.code) (e as any).code = this.code;

				throw e;
			}
			else // Ctor 1
			{
				// Very cool: TS knows that 'args[0]' has type ErrorOptions here.
				const options = args[0];

				for (const propName in options)
				{
					// Since functions are objects, we can use properties
					// as a replacement for "static variables", i. e. variables
					// that keep their values between invocations.
					// N. B.: When using 'this', the props can only be accessed from inside
					//        the function body, as opposed to using the function name.

					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
					this[propName] = options[propName];
				}
			}

			break;
		case 2: // Ctor 2
			{
				let message = args[0] as string;

				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				if (this.messagePrefix) message = this.messagePrefix as string + ' ' + message;

				const e = new Error(message);

				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				(e as any).code = args[1] as string;
			}
	}
}
