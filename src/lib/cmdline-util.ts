/*
* cmdline-util.ts
* Author: derkallevombau
* Created: Nov 13, 2019
*/

/* eslint-disable tsdoc/syntax */

export interface CmdLineOption
{
	/**
	 * One (or more, space-separated) names(s), e. g. '-d' or '--debug -d'.
	 */
	names: string,

	/**
	 * A description of the option's effect and the format of the value to be specified, if any.\
	 * Used to print a summary when your program is executed with help option.
	 */
	description?: string,

	/**
	 * For an option that needs a value:\
	 * A regular expression which, if supplied, the supplied value will be matched against.
	 * An exception will be thrown if validation fails.
	 */
	valueValidationRegExp?: RegExp,

	/**
	 * For an option that needs a value:\
	 * A function that takes and processes the supplied value.
	 */
	processValue?: (value: string) => void,

	/**
	 * For an option that doesn't need a value:\
	 * A function that performs the appropriate action.
	 */
	action?: () => void
}

interface CmdLineOptionInternal extends CmdLineOption
{
	/**
	 * Supplied variant of option, if any.
	 */
	variant?: string,

	/**
	 * Value supplied for option, if any.
	 */
	value?: string
}

export default class CmdLineUtil
{
	private optionRequired: boolean;
	private helpPrinted: () => void;
	private opts: CmdLineOption[];

	/**
	 * Creates and initialises a new instance of CmdLineUtil without help support.
	 * @param options - A `CmdLineOption` for each option your program shall understand.
	 */
	constructor(...options: CmdLineOption[]);

	/**
	 * Creates and initialises a new instance of CmdLineUtil.
	 * @param helpPrinted - A function that will be called after your program has been invoked with '-h'
	 * or '--help' and help has been printed, so your program can do cleanup and exit gracefully.
	 * @param options - A `CmdLineOption` for each option your program shall understand.
	 */
	constructor(helpPrinted: () => void, ...options: CmdLineOption[]);

	/**
	 * Creates and initialises a new instance of CmdLineUtil.
	 * @param optionRequired - If `true` and no option(s) have been supplied, an error will be thrown.
	 * @param helpPrinted - A function that will be called after your program has been invoked with '-h'
	 * or '--help' and help has been printed, so your program can do cleanup and exit gracefully.
	 * @param options - A `CmdLineOption` for each option your program shall understand.
	 */
	constructor(optionRequired: boolean, helpPrinted: () => void, ...options: CmdLineOption[]);

	constructor(...args: any[]) // Common ctor
	{
		switch (args.length)
		{
			case 1: // Ctor 1
				this.optionRequired = false;
				this.opts = args[0] as CmdLineOption[];

				break;
			case 2: // Ctor 2
				this.optionRequired = false;
				this.helpPrinted = args[0] as () => void;
				this.opts = args[1] as CmdLineOption[];

				break;
			case 3: // Ctor 3
				this.optionRequired = args[0] as boolean;
				this.helpPrinted = args[1] as () => void;
				this.opts = args[2] as CmdLineOption[];
		}
	}

	/**
	 * @throws `Error` with code 'ECMDLINE'.
	 */
	process(): void
	{
		for (const opt of this.opts)
		{
			if (opt.action && opt.processValue)
			{
				this.error(`${opt.names}: CmdLineOption.action and CmdLineOption.processValue are mutually exclusive.`);
			}

			if (!opt.action && !opt.processValue)
			{
				this.error(`${opt.names}: Neither CmdLineOption.action nor CmdLineOption.processValue specified, option will have no effect.`);
			}
		}

		// process.argv[0] is the node executable,
		// process.argv[1] is the script,
		// process.argv[3] is the first command line option,
		// so we remove the first two elements.
		const args = process.argv.slice(2);

		if (this.optionRequired && !args.length)
		{
			this.printHelp();

			this.error('No option specified.');
		}

		let optToStoreValueFor: CmdLineOptionInternal;

		// Store options and arguments

		for (const arg of args)
		{
			// Check if arg is a valid option name.
			// As opposed to Perl, RegExp literals in JS don't support interpolation,
			// thus we use 'RegExp()' which can take a string.
			// N.B.: RegExp#exec is faster than String#match and both work the same when not using the /g flag.
			//       RegExp#test should be even faster.
			const opt = this.opts.find(opt => RegExp(` ${arg} `).test(` ${opt.names} `)) as CmdLineOptionInternal;

			if (!opt && !optToStoreValueFor)
			{
				// Check for help option, but only accept it if we have a helpPrinted callback.
				if (this.helpPrinted && RegExp(` ${arg} `).test(' -h --help '))
				{
					this.printHelp();
					this.helpPrinted();

					return;
				}

				this.error(`Invalid command line option: '${arg}'.`);
			}

			if (!opt) // arg is value for optToStoreValueFor, store it.
			{
				// Match arg against regexp, if any.
				if (optToStoreValueFor.valueValidationRegExp && !RegExp(opt.valueValidationRegExp).test(arg))
				{
					this.error(`Invalid value '${arg}' for option '${opt.variant}'.`);
				}

				optToStoreValueFor.value = arg;
				optToStoreValueFor = undefined;
			}
			else // arg is option
			{
				opt.variant = arg; // Store supplied option variant for error message, if any.

				if (opt.processValue || opt.valueValidationRegExp) // arg is option that needs a value, store it in next iteration.
				{
					optToStoreValueFor = opt;
					continue;
				}
				// else arg is option that doesn't need a value, nothing to do here.
			}
		}

		// Execute supplied functions

		for (const opt of this.opts as CmdLineOptionInternal[])
		{
			if (!opt.variant) continue;

			if (opt.processValue && opt.value === undefined)
			{
				this.error(`No value specified for option '${opt.variant}'.`);
			}
			else if (opt.processValue) opt.processValue(opt.value);
			else if (opt.action) opt.action();
		}
	}

	private printHelp()
	{
		console.log('Sorry, help has not been implemented yet.');
	}

	/**
	 * Throws an `Error` object constructed
	 * with `message` and `code` property set to 'ECMDLINE'.
	 * @param message - Error message
	 */
	private error(message: string): void
	{
		const e = new Error(message);
		// Solution from StackOverflow to access a non-existing property like in JS.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		(e as any).code = 'ECMDLINE';
		throw e;
	}
}
