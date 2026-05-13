import * as ts from './typescript';

export type TypeScriptFullSource = typeof ts;

export type TypeScriptSystemSurfaceSource = Pick<
	ts.System,
	| 'write'
	| 'readFile'
	| 'writeFile'
	| 'resolvePath'
	| 'fileExists'
	| 'directoryExists'
	| 'createDirectory'
	| 'getExecutingFilePath'
	| 'getCurrentDirectory'
	| 'getDirectories'
	| 'readDirectory'
	| 'exit'
	| 'realpath'
	| 'base64decode'
	| 'base64encode'
>;
