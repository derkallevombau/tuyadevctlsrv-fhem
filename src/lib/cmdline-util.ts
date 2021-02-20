/**
 * @file cmdline-util.js
 * Created on: Nov 13 2019
 * @author derkallevombau
 */

class CmdLineUtil
{
	/**
	 * Creates and initialises a new instance of CmdLineUtil
	 * @param {...Option} options
	 * @typedef {object} Option An object describing a command line option.
	 * @property {string} Option.names One (or more, space-separated) names(s), e. g. '-d' or '--debug -d'.
	 * @property {string} [Option.helpNames] One (or more, space-separated) names(s) that will cause an options summary
	 * to be printed if your program is executed with any of these. If this string contains the word 'noopt', a summary
	 * will be printed if your program is executed without arguments; useful if your program needs at least one argument
	 * in order to do its job. If you set this to the empty string, help will be disabled. Defaults to '--help -h'.
	 * @property {string} [Option.description] A description of the option's effect and the format of the value to be specified, if any.
	 * Used to print a summary when your program is executed with help option.
	 * @property {RegExp} [Option.validationRegExp] For an option that needs a value:
	 * A regular expression which, if supplied, the supplied value will be matched against.
	 * An exception will be thrown if validation fails.
	 * @property {Function} [Option.processValue] For an option that needs a value: A function that takes and processes the supplied value.
	 * @property {Function} [Option.action] For an option that doesn't need a value: A function that performs the appropriate action.
	 */
	constructor(logger, ...options)
	{
		/**
		 * @private
		 */
		this.logger = logger;

		/**
		 * @private
		 */
		this.opts = options;
	}

	process()
	{
		for (const opt of this.opts) if (opt.action && opt.processValue)
			this.error(`${opt.names}: Option.action and Option.processValue are mutually exclusive`);

		let optToStoreValueFor;

		for (const arg of process.argv.slice(2))
		{
			// Check if arg is a valid option name.
			// As opposed to Perl, RegExp literals in JS don't support interpolation,
			// thus we use 'RegExp()' which can take a string.
			const opt = this.opts.find(opt => ` ${opt.names} `.match(RegExp(` ${arg} `)));

			if (!opt && !optToStoreValueFor)
			{
				this.error(`Invalid command line argument: '${arg}'`);
			}

			if (!opt) // arg is value for optToStoreValueFor, store it.
			{
				// @ts-ignore
				optToStoreValueFor.value = arg;
				optToStoreValueFor       = undefined;
			}
			else // arg is option
			{
				// @ts-ignore
				opt.supplied = arg; // Store supplied variant for error message, if any.

				if (opt.processValue) // arg is option that needs a value, store it in next iteration.
				{
					optToStoreValueFor = opt;
					continue;
				}
				// else arg is option that doesn't need a value, nothing to do
			}
		}

		for (const opt of this.opts)
		{
			// @ts-ignore
			if (!opt.supplied) continue;

			// @ts-ignore
			if (opt.processValue && opt.value === undefined)
			{
				// @ts-ignore
				this.error(`No value specified for option '${opt.supplied}'`);
			}
			// @ts-ignore
			else if (opt.processValue) opt.processValue(opt.value);
			else if (opt.action) opt.action();
		}
	}

	/**
	 * Throws an `Error` object constructed
	 * with `message` and code property set to 'ECMDLINE'.
	 * @param {string} message
	 */
	error(message)
	{
		const e = new Error(message);
		// @ts-ignore
		e.code = 'ECMDLINE';
		throw e;
	}
}

module.exports = CmdLineUtil;
