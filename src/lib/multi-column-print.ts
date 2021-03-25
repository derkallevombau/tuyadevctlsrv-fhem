/*
* multi-column-print.ts
* Author: derkallevombau
* Created: Mar 23, 2021
*/

/* eslint-disable tsdoc/syntax */

interface MultiColPrintOpts
{
	/**
	 * Spacing between columns. Default: 2.
	 */
	spacing?: number;

	/**
	 * An array of strings to be used as column headers.
	 */
	columnHeaders?: string[];
}

export interface MultiColPrintArrayOpts extends MultiColPrintOpts
{
	/**
	 * Array of columns.\
	 * Each column is defined by an array of strings or types
	 * that can be converted to string via `String()`.
	 */
	columns: any[][];
}

export interface MultiColPrintObjectOpts extends MultiColPrintOpts
{
	/**
	 * Array of objects of same structure (at least, each object must have
	 * all the properties defined in `propNames`).\
	 * Each column is defined by a property name in `propNames`, so each
	 * object defines a row.
	 */
	objects: { [key: string]: any; }[];

	/**
	 * Array of strings of names of properties whose values shall
	 * be printed in columns, in that order.\
	 * If omitted, the property names of the first object will be used.
	 */
	propNames?: string[];

	/**
	 * If true, the property names will be used as column headers.\
	 * This option and `columnHeaders` are mutually exclusive.\
	 * Default: false.
	 */
	usePropNamesAsColHeaders?: boolean;
}

/**
 * Prints an arbitrary number of columns defined via arrays with adjustable spacing.
 * @param options - An object defining the columns and optionally spacing and headers.
 */
export default function multiColumnPrint(options: MultiColPrintArrayOpts): void;

/**
 * Prints an arbitrary number of columns defined via objects with adjustable spacing.
 * @param spacing - Spacing between columns.
 * @param columns - Provide an array of strings for each column to be printed.
 */
export default function multiColumnPrint(options: MultiColPrintObjectOpts): void;

export default function multiColumnPrint(options: MultiColPrintArrayOpts | MultiColPrintObjectOpts): void
{
	// Helper functions

	// The return type is a "Type predicate"

	function isMultiColPrintArrayOpts(options): options is MultiColPrintArrayOpts
	{
		if ((options as unknown as MultiColPrintArrayOpts).columns) return true;
		return false;
	}

	function isMultiColPrintObjectOpts(options): options is MultiColPrintObjectOpts
	{
		if ((options as unknown as MultiColPrintObjectOpts).objects) return true;
		return false;
	}

	const spacing: number = options.spacing || 2;
	const columns: string[][] = [];

	function processColumnHeaders(columnHeaders: string[])
	{
		if (columnHeaders)
		{
			if (columnHeaders.length !== columns.length) throw new Error('multiColumnPrint: Number of column headers does not match number of columns.');

			// Append a newline to the last column header...

			columnHeaders[columnHeaders.length - 1] += '\n';

			// ... and for each column, insert the header before the first element.
			iterateOverColumns(
				(iCol, col) =>
				{
					col.unshift(columnHeaders[iCol]);
				}
			);
		}
	}

	if (isMultiColPrintArrayOpts(options)) // Ctor 1
	{
		// Since we are using a "Type predicate" here,
		// TS knows that options is of type MultiColPrintArrayOpts.

		// Convert each element of each column to string.

		for (const columnIn of options.columns)
		{
			const columnOut: string[] = [];

			for (const elementIn of columnIn)
			{
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				let value = elementIn;

				if (value === undefined) value = '';

				columnOut.push(String(value));
			}

			columns.push(columnOut);
		}

		// Now, columns is populated with arrays of strings.

		const columnHeaders = options.columnHeaders;

		processColumnHeaders(columnHeaders);
	}
	else if (isMultiColPrintObjectOpts(options)) // Ctor 2
	{
		const propNames = options.propNames || Object.keys(options.objects[0]);

		for (const propName of propNames) // Each propName defines a column
		{
			const columnOut: string[] = [];

			for (const obj of options.objects) // Each obj defines a row
			{
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				let value = obj[propName];

				if (value === undefined) value = '';

				columnOut.push(String(value));
			}

			columns.push(columnOut);
		}

		// Now, columns is populated with arrays of strings.

		let columnHeaders: string[];

		if (options.columnHeaders && options.usePropNamesAsColHeaders) throw new Error("multiColumnPrint: 'columnHeaders' and 'usePropNamesAsColHeaders' are mutually exclusive.");
		else if (options.usePropNamesAsColHeaders)
		{
			columnHeaders = propNames;
		}
		else if (options.columnHeaders)
		{
			columnHeaders = options.columnHeaders;
		}

		processColumnHeaders(columnHeaders);
	}

	// Helper functions

	function iterateOverColumns(columnAction: (iCol: number, col: string[]) => void)
	{
		for (let iCol = 0; iCol < columns.length; iCol++) columnAction(iCol, columns[iCol]);
	}

	let maxColumnLength: number;

	function iterateOverRows(rowAction: (iRow: number) => void)
	{
		for (let iRow = 0; iRow < maxColumnLength; iRow++) rowAction(iRow);
	}

	// Determine max column length

	iterateOverColumns(
		(iCol, col) =>
		{
			if (!iCol || col.length > maxColumnLength) maxColumnLength = col.length;
		}
	);

	// Fill columns with too few elements with empty strings

	iterateOverColumns(
		(iCol, col) =>
		{
			if (col.length < maxColumnLength)
			{
				columns[iCol] = col.concat(new Array<string>(maxColumnLength - col.length));
				columns[iCol].fill('', col.length, maxColumnLength - col.length); // col is still the old column
			}
		}
	);

	// Now, the length of all columns is maxColumnLength.

	// Determine max column width
	// and fill column elements with spaces as appropriate.

	const maxColumnWidthFromColIdx = new Array<number>(columns.length);

	iterateOverColumns(
		(iCol, col) =>
		{
			if (!iCol || col.length > maxColumnLength) maxColumnLength = col.length;

			iterateOverRows(
				iRow =>
				{
					if (!iRow || col[iRow].length > maxColumnWidthFromColIdx[iCol])
					{
						maxColumnWidthFromColIdx[iCol] = col[iRow].length;
					}
				}
			);

			iterateOverRows(
				iRow =>
				{
					const maxColumnWidth = maxColumnWidthFromColIdx[iCol];

					if (col[iRow].length < maxColumnWidth + spacing)
					{
						col[iRow] += ' '.repeat(maxColumnWidth + 2 - col[iRow].length);
					}
				}
			);
		}
	);

	// Create lines from columns elements and print them.

	iterateOverRows(
		iRow =>
		{
			let line = '';

			iterateOverColumns(
				(_iCol, col) => line += col[iRow]
			);

			console.log(line);
		}
	);
}
