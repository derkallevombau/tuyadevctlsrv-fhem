/*
* log4js-config.ts
* Author: derkallevombau
* Created: Mar 17, 2021
*/

/* eslint-disable tsdoc/syntax */

import { InitialiserExclude, InitialiserExcludeOptional, applyConfig } from 'src/lib/object-initializers';

export type Levels = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/// Class initialiser types

// Exclude 'appenders' since this is treated specially.
type CatConfig = InitialiserExclude<Cat, 'appenders'>;

/// Classes

// Layouts

abstract class Layout
{
	type: 'basic' | 'coloured' | 'pattern';
}

export class LayoutBasic extends Layout
{
	constructor()
	{
		super();

		this.type = 'basic';
	}
}

export class LayoutColored extends Layout
{
	constructor()
	{
		super();

		this.type = 'coloured';
	}
}

export class LayoutPattern extends Layout
{
	/**
	 * Specifier for the output format.\
	 * See "Pattern format" in the [log4js-node layouts doc](https://log4js-node.github.io/log4js-node/layouts.html).\
	 * We provide the preset pattern '%d{yyyy-MM-dd hh:mm:ss.SSS} %5.10p %c: %m'.
	 */
	pattern = '%d{yyyy-MM-dd hh:mm:ss.SSS} %5.10p %c: %m';

	/**
	 * User-defined tokens to be used in the pattern.\
	 * See "Tokens" in the [log4js-node layouts doc](https://log4js-node.github.io/log4js-node/layouts.html).
	 */
	// eslint-disable-next-line @typescript-eslint/ban-types
	tokens?: { [key: string]: string | Function; };

	// Exclude 'type' since it has a fixed value.
	// Make 'pattern' optional since we have set a predefied value.
	constructor(config: InitialiserExcludeOptional<LayoutPattern, 'type', 'pattern'>)
	{
		super();

		this.type = 'pattern';

		applyConfig(config, this);
	}
}

// Appenders

abstract class Appender
{
	type: 'stdout' | 'dateFile';

	/**
	 * See [layouts](https://log4js-node.github.io/log4js-node/layouts.html).
	 * Defaults to basic layout.
	 */
	layout?: LayoutBasic | LayoutColored | LayoutPattern;
}

export class AppenderStdout extends Appender
{
	// Exclude 'type' since we set it in the ctor.
	constructor(config: InitialiserExclude<AppenderStdout, 'type'>)
	{
		super();

		this.type = 'stdout';

		applyConfig(config, this);
	}
}

export class AppenderDateFile extends Appender
{
	/**
	 * The path of the file where you want your logs written.
	 */
	filename: string;

	/**
	 * The pattern to use to determine when to roll the logs.\
	 * Defaults to '.yyyy-MM-dd'.
	 */
	pattern?: string;

	/**
	 * See [Node.js file modes](https://nodejs.org/dist/latest-v14.x/docs/api/fs.html#fs_file_modes)\
	 * Defaults to 0o644, i. e. owner: read/write, group and others: read only.
	 */
	mode?: number;

	/**
	 * Compress the backup files during rolling (backup files will have .gz extension)\
	 * Defaults to false.
	 */
	compress?: boolean;

	/**
	 * Include the pattern in the name of the current log file as well as the backups.\
	 * Defaults to false.
	 */
	alwaysIncludePattern?: boolean;

	/**
	 * If this value is greater than zero, then files older than that many days will be deleted during log rolling.
	 * Defaults to 0.
	 */
	daysToKeep?: number;

	/**
	 * Preserve the file extension when rotating log files (file.log becomes file.2017-05-30.log instead of file.log.2017-05-30).
	 * Defaults to false.
	 */
	keepFileExt?: boolean;

	// Exclude 'type' since we set it in the ctor.
	constructor(config: InitialiserExclude<AppenderDateFile, 'type'>)
	{
		super();

		this.type = 'dateFile';

		applyConfig(config, this);
	}
}

// Category

class Cat
{
	/**
	 * string array of names of appenders to use for all cats.\
	 * appenders gets set to this in the ctor, and since an array
	 * is a reference type, a change made to this array will change the appenders array
	 * of each instance of this class since all these arrays are actually the same object.\
	 * We need this workaround since a static field doesn't show up in an instance.\
	 * The benefit of using a static field is that it doesn't matter if Config#addAppender
	 * is called before or after Config#addCategory.\
	 * Why do we set the same appenders to all cats? ATM I don't see any reason why you would want
	 * to have different appenders for the various cats, but I may be wrong...
	 */
	private static appenders_: string[] = [];

	/**
	 * string array of names of appenders to use for this cat.\
	 * Not to be confused with `Config#appenders`.
	 */
	appenders: string[];

	level: Levels;

	/**
	 * Setting this to true will make log events for this category use the call stack
	 * to generate line numbers and file names in the event.
	 * See [pattern layout](https://log4js-node.github.io/log4js-node/layouts.html)
	 * for how to output these values in your appenders.\
	 * Defaults to false.
	 */
	enableCallStack?: boolean;

	/**
	 * Do not call directly; use Config#addAppender
	 */
	static addAppender(name: string)
	{
		// Within a static method, 'this' refers to the class.
		const appenders = this.appenders_;

		if (!appenders.includes(name)) appenders.push(name);
	}

	/**
	 * Do not call directly; use Config#removeAppender
	 */
	static removeAppender(name: string)
	{
		const appenders = this.appenders_;

		if (appenders.includes(name)) appenders.splice(appenders.indexOf(name), 1);
	}

	constructor(config: CatConfig)
	{
		applyConfig(config, this);

		// See the comment on appenders_.
		this.appenders = Cat.appenders_;
	}
}

// Main class

export class Config
{
	/**
	 * Contains all defined appenders.\
	 * Object whose keys are the appender names to be put
	 * in the `Cat#appenders` array.\
	 * The respective values are subclasses of `Appender`.\
	 * Of course, we don't enforce the use of a `AppenderStdout`,
	 * but if it is used, we want it to use the name 'stdout'.\
	 * Other subclasses may use arbitrary names.
	 */
	appenders: { stdout?: AppenderStdout; } & { [key: string]: AppenderDateFile; } = {};

	/**
	 * Contains all defined logging cats.\
	 * Here, we enforce the use of the 'default' cat -
	 * even if it isn't used - because log4js complains
	 * if it is missing.
	 */
	categories: { default: Cat; } & { [key: string]: Cat; };

	// Sad: I spent so much time to figure out how to exclude properties by type,
	// now I see that I don't want to use an initialiser here at all :(.
	// However, now I understand how keyof, T[K], and conditional types work and when
	// extends is distributive and when not, so it was no waste of time :).
	// // eslint-disable-next-line @typescript-eslint/ban-types
	// constructor(initialiser: { [K in keyof Config as ExcludeByValueType<Config, K, Function>]: Config[K] })
	// {
	// 	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	// 	for (const k in initialiser) this[k] = initialiser[k];
	// }


	// The function body could be less complex if appender was always the first param
	// by using a tuple type with optional element: '...args: [Appender, name?]',
	// but it's preferable to write down the name first, if any.

	/**
	 * Adds a stdout appender with name 'stdout'.\
	 * It will automatically be assigned to each category you have already added
	 * or you will add later.
	 * @param appender - An instance of `AppenderStdout`
	 */
	addAppender(appender: AppenderStdout): void;

	/**
	 * Adds the supplied appender.\
	 * It will automatically be assigned to each category you have already added
	 * or you will add later.
	 * @param name - The name of the new appender
	 * @param appender - An instance of `AppenderDateFile`
	 */
	addAppender(name: string, appender: AppenderDateFile): void;

	addAppender(nameOrAppender: string | Appender, appender_?: Appender): void
	{
		let appender: Appender, name: string;

		if (nameOrAppender instanceof Appender)
		{
			appender = nameOrAppender;
			name = 'stdout';

			if (appender instanceof AppenderStdout)
			{
				this.appenders.stdout ||= appender; // TS knows the subclass type of appender here
			}
		}
		else
		{
			appender = appender_;
			name = nameOrAppender;

			if (appender instanceof AppenderDateFile)
			{
				// Cool: Whereas Node.js merely understands the "undefined-or" (||) known from Perl (//),
				// TS also knows the respective assignment operator.
				this.appenders[name] ||= appender;
			}
		}

		// Add appender to all cats, no matter
		// if already defined or not.
		Cat.addAppender(name);
	}

	removeAppender(name: string): void
	{
		if (this.appenders[name]) delete this.appenders[name];

		Cat.removeAppender(name);
	}

	addCategory(name: string, config: CatConfig): void
	{
		if (!this.categories)
		{
			// Since we need a 'default' cat, create it with the given config.
			// It will be deleted when the user explicitly defines a default cat.
			this.categories = { default: new Cat(config) };

			if (name !== 'default') this.categories[name] = new Cat(config);
		}
		else
		{
			if (name === 'default') this.categories[name] = new Cat(config);
			else this.categories[name] ||= new Cat(config);
		}
	}

	removeCategory(name: string): void
	{
		if (this.categories && this.categories[name]) delete this.categories[name];
	}

	/**
	 * Changes the minimum level to log.
	 * @param catName - Name of category to change the level for.
	 * @param level - The new level.
	 * @returns `true` if category `catName` exists, else `false`.
	 */
	changeLevel(catName: string, level: Levels): boolean

	/**
	 * Changes the minimum level to log for all categories.
	 * @param level - The new level.
	 */
	changeLevel(level: Levels): void

	changeLevel(catNameOrLevel: string, level_?: Levels): boolean | void
	{
		let level: Levels;

		if (level_)
		{
			const catName = catNameOrLevel;
			level = level_;

			if (!this.categories || !this.categories[catName]) return false;

			this.categories[catName].level = level;

			return true;
		}
		else // No catName => Set level for all cats
		{
			for (const catName in this.categories) this.categories[catName].level = level;
		}
	}
}
