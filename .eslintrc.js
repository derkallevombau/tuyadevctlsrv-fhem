module.exports = {
	"root": true,
	"env": {
		"es2020": true,
		"node": true
	},
	"parser": "@typescript-eslint/parser",
	"parserOptions": {
		/// Core parser options
		"ecmaVersion": 2020,
		// For a script, place a .eslintrc.js in its dir with contents
		// 'module.exports = { "parserOptions": { "sourceType": "script" } };'
		// to override this option.
		// A file that imports or exports sth. is a module, otherwise it's a script.
		"sourceType": "module",
		/// Options for @typescript-eslint/parser
		"tsconfigRootDir": `__dirname/..`,
		"project": "tsconfig.json"
	},
	"plugins": [
		"@typescript-eslint/eslint-plugin",
		"eslint-plugin-tsdoc"
	],
	"extends": [
		"eslint:recommended",
		"plugin:@typescript-eslint/eslint-recommended",
		"plugin:@typescript-eslint/recommended",
		"plugin:@typescript-eslint/recommended-requiring-type-checking"
	],
	// This fixes
	//   'Parsing error: "parserOptions.project" has been set for @typescript-eslint/parser.
	//   The file does not match your project config: .eslintrc.js.
	//   The file must be included in at least one of the projects provided.'
	//   And the same for typedoc.js.
	"ignorePatterns": [
		"**/*.js"
	],
	"rules": {
		/// Additionally enabled (N.B.: The corresponding base rules must be disabled)
		"no-extra-parens": "off",
		"@typescript-eslint/no-extra-parens": "warn",

		"semi": "off",
		"@typescript-eslint/semi": "warn",

		"brace-style": "off",
    	"@typescript-eslint/brace-style": ["warn", "allman", { "allowSingleLine": true }],

		"quotes": "off",
		"@typescript-eslint/quotes": ["warn", "single", { "avoidEscape": true }],
		/// Adjustments
		"@typescript-eslint/no-use-before-define": ["error", "nofunc"], // Functions are hoisted
		/// Disabled
		// Annoying to get this warning even if the return type is inferred.
		"@typescript-eslint/explicit-function-return-type": "off",

		// Dispensable and doesn't take into account that you might want
		// to align consecutive lines.
		"@typescript-eslint/type-annotation-spacing": "off",

		"@typescript-eslint/no-explicit-any": "off",

		/// eslint-plugin-tsdoc
		"tsdoc/syntax": "warn"
	},
	"reportUnusedDisableDirectives": true
};
