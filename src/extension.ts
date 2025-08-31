/* eslint-disable eqeqeq */
/* eslint-disable curly */
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as readline from 'readline';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import { Loc, SymbolicExecutionError, VFContext, VFResult, VFRange, UseSite, ExecutingCtxt, BranchKind, ExecutionForest, ErrorAttributesObject, QuickFix, ErrorAttributes } from './verifast';
import * as path_ from 'path';

function sortedListOfEntries(o: {[index: string]: string}) {
	const entries = Object.entries(o).map(([key, value]) => key + ": " + value);
	entries.sort();
	return entries;
}

/**
 * Returns the least index such that all elements in `haystack` that are less than `needle` are below that index.
 */
function binarySearch(haystackLength: number, isLessThanNeedle: (index: number) => boolean): number {
	let low = 0; // All elements below `low` are less than `needle`
	let high = haystackLength; // All elements not below `high` are not less than `needle`
	for (;;) {
		if (low == high)
			return high;
		const i = low + Math.floor((high - low) / 2);
		if (isLessThanNeedle(i)) {
			low = i + 1;
		} else {
			high = i;
		}
	}
}

function locationOfLoc(baseUri: vscode.Uri, l: Loc): vscode.Location {
	switch (l[0]) {
		case 'Lexed':
			const [[startPath, startLine, startCol], [endPath, endLine, endCol]] = l[1];
			assert(startPath === endPath);
			const canonicalPath = path_.isAbsolute(startPath) ? vscode.Uri.file(startPath) : vscode.Uri.joinPath(baseUri, startPath);
			const range = new vscode.Range(startLine - 1, startCol - 1, endLine - 1, endCol - 1);
			return new vscode.Location(canonicalPath, range);
		default:
			assert(false);
	}
}

let quickFixes: QuickFix[] = [];

function diagnosticsOfLocMsg(baseUri: vscode.Uri, l: Loc, msg: string, info: vscode.DiagnosticRelatedInformation[], errorAttributes: ErrorAttributes): [vscode.Uri, vscode.Diagnostic[]][] {
	switch (l[0]) {
		case 'Lexed':
			const location = locationOfLoc(baseUri, l);
			const diagnostic = new vscode.Diagnostic(location.range, msg);
			diagnostic.source = "VeriFast";
			diagnostic.relatedInformation = info;
			quickFixes = (typeof errorAttributes === 'object' ? errorAttributes.quick_fixes : undefined) || [];
			return [[location.uri, [diagnostic]]];
		default:
			assert(false);
	}
}

class Step extends vscode.TreeItem {

	childSteps: Step[] = [];

	constructor(baseUri: vscode.Uri, readonly parent: Step|null, label: string, readonly frames: ExecutingCtxt[], readonly assumptions: string[], readonly branches: [BranchKind, Loc][]) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.command = {
			command: 'verifast.showStep',
			arguments: [baseUri, this],
			title: 'Show'
		};
	}

	setChildSteps(childSteps: Step[]) {
		this.childSteps = childSteps;
		this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
	}
}

function last<T>(items: T[]) { return items[items.length - 1]; }

function createSteps(baseUri: vscode.Uri, ctxts: VFContext[]): [Step[], Step] {
	const assumptions: string[] = [];
	const branches: [BranchKind, Loc][] = [];
	const stack: ExecutingCtxt[] = [];
	const stepListStack: Step[][] = [];
	let currentStepList: Step[] = [];
	let currentParentStep: Step | null = null;
	let latestExecutingCtxt: ExecutingCtxt|null = null;
	let latestStep: Step|null = null;

	function popSubcontext() {
		const top = stack.pop();
		assert(top !== undefined);
		latestExecutingCtxt = top;
		const topStepList = stepListStack.pop();
		assert(topStepList !== undefined);
		topStepList[topStepList.length - 1].setChildSteps(currentStepList);
		currentStepList = topStepList;
		currentParentStep = stepListStack.length == 0 ? null : last(last(stepListStack));
	}

	for (let i = ctxts.length - 1; 0 <= i; i--) {
		const ctxt = ctxts[i];
		switch (ctxt[0]) {
			case 'Executing':
				const [_, h, env, l, msg] = ctxt;
				latestExecutingCtxt = ctxt;
				currentStepList.push(latestStep = new Step(baseUri, currentParentStep, msg, [ctxt].concat(stack), assumptions.slice(), branches.slice()));
				break;
			case 'PushSubcontext':
				assert(latestExecutingCtxt !== null);
				stack.push(latestExecutingCtxt);
				latestExecutingCtxt = null;
				stepListStack.push(currentStepList);
				currentParentStep = currentStepList[currentStepList.length - 1];
				currentStepList = [];
				break;
			case 'PopSubcontext':
				popSubcontext();
				break;
			case 'Assuming':
				assumptions.push(ctxt[1]);
				break;
			case 'Branching':
				assert(latestExecutingCtxt !== null);
				currentStepList.push(latestStep = new Step(baseUri, currentParentStep, ctxt[1] == 'LeftBranch' ? 'Executing left branch' : 'Executing right branch', [latestExecutingCtxt].concat(stack), assumptions.slice(), branches.slice()));
				const ultimateCaller = stack.length == 0 ? latestExecutingCtxt : stack[stack.length - 1];
				branches.push([ctxt[1], ultimateCaller[3]]);
				break;
		}
	}

	while (stack.length > 0)
		popSubcontext();

	assert(latestStep !== null);
	return [currentStepList, latestStep];
}

class StringTreeDataProvider implements vscode.TreeDataProvider<string> {
	constructor(private elements: string[]) {}

	private _onDidChangeTreeData: vscode.EventEmitter<string | undefined | null | void> = new vscode.EventEmitter<string | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<string | undefined | null | void> = this._onDidChangeTreeData.event;
  
	setElements(newElements: string[]): void {
		this.elements = newElements;
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: string): vscode.TreeItem {
		return {label: element};
	}

	getChildren(element?: string): string[] {
		if (element !== undefined)
			return [];
		return this.elements.slice();
	}
}

class StepTreeDataProvider implements vscode.TreeDataProvider<Step> {
	constructor(private toplevelSteps: Step[]) {}

	private _onDidChangeTreeData: vscode.EventEmitter<Step | undefined | null | void> = new vscode.EventEmitter<Step | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<Step | undefined | null | void> = this._onDidChangeTreeData.event;
  
	setToplevelSteps(newToplevelSteps: Step[]): void {
		this.toplevelSteps = newToplevelSteps;
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: Step): vscode.TreeItem {
		return element;
	}

	getChildren(element?: Step): Step[] {
		if (element === undefined)
			return this.toplevelSteps;
		return element.childSteps;
	}

	getParent(element: Step): vscode.ProviderResult<Step> {
		return element.parent;
	}
}

let extensionContext: vscode.ExtensionContext;

const currentStatementDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: "#FFFF00"
});
let currentStatementDecorationEditor: vscode.TextEditor|null = null;
const callerDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: "#00FF00"
});
const callerDecorationEditors: vscode.TextEditor[] = [];

const extensionDir = path_.dirname(__dirname);

const leftBranchDecorationEditors: vscode.TextEditor[] = [];
const leftBranchDecorationType = vscode.window.createTextEditorDecorationType({
	before: {
		contentIconPath: extensionDir + '/branch-left-decoration.svg',
		width: '14px',
		height: '14px'
	}
});
const rightBranchDecorationEditors: vscode.TextEditor[] = [];
const rightBranchDecorationType = vscode.window.createTextEditorDecorationType({
	before: {
		contentIconPath: extensionDir + '/branch-right-decoration.svg',
		width: '14px',
		height: '14px'
	}
});

let heapTreeView: vscode.TreeView<string>|null = null;
let heapTreeViewDataProvider: StringTreeDataProvider|null = null;

let localsTreeView: vscode.TreeView<string>|null = null;
let localsTreeViewDataProvider: StringTreeDataProvider|null = null;

let callerLocalsTreeView: vscode.TreeView<string>|null = null;
let callerLocalsTreeViewDataProvider: StringTreeDataProvider|null = null;

let assumptionsTreeView: vscode.TreeView<string>|null = null;
let assumptionsTreeViewDataProvider: StringTreeDataProvider|null = null;

let stepsTreeView: vscode.TreeView<Step>|null = null;
let stepsTreeViewDataProvider: StepTreeDataProvider|null = null;

let diagnosticsCollection: vscode.DiagnosticCollection;

let currentBranches: [BranchKind, vscode.Location][] = [];

function clearDecorations() {
	if (currentStatementDecorationEditor != null) {
		currentStatementDecorationEditor.setDecorations(currentStatementDecorationType, []);
		currentStatementDecorationEditor = null;
	}
	for (const editor of callerDecorationEditors)
		editor.setDecorations(callerDecorationType, []);
	callerDecorationEditors.length = 0;
	for (const editor of leftBranchDecorationEditors)
		editor.setDecorations(leftBranchDecorationType, []);
	leftBranchDecorationEditors.length = 0;
	for (const editor of rightBranchDecorationEditors)
		editor.setDecorations(rightBranchDecorationType, []);
	rightBranchDecorationEditors.length = 0;

	currentBranches = [];
}

function clearTrace() {
	diagnosticsCollection.clear();
	clearDecorations();
	localsTreeViewDataProvider!.setElements([]);
	callerLocalsTreeViewDataProvider!.setElements([]);
	heapTreeViewDataProvider!.setElements([]);
	assumptionsTreeViewDataProvider!.setElements([]);
	stepsTreeViewDataProvider!.setToplevelSteps([]);
}

function showBranchesInEditor(editor: vscode.TextEditor) {
	const leftBranchRanges: vscode.Range[] = [];
	const rightBranchRanges: vscode.Range[] = [];
	for (const [kind, location] of currentBranches) {
		if (location.uri.toString() == editor.document.uri.toString())
			if (kind == 'LeftBranch') {
				leftBranchDecorationEditors.push(editor);
				leftBranchRanges.push(location.range);
			} else {
				rightBranchDecorationEditors.push(editor);
				rightBranchRanges.push(location.range);
			}
	}
	editor.setDecorations(leftBranchDecorationType, leftBranchRanges);
	editor.setDecorations(rightBranchDecorationType, rightBranchRanges);
}

async function showStep(baseUri: vscode.Uri, step: Step) {
	await vscode.commands.executeCommand('workbench.view.extension.verifast');

	clearDecorations();

	for (const [kind, l] of step.branches)
		currentBranches.push([kind, locationOfLoc(baseUri, l)]);

	const frames = step.frames;

	const groups = [];
	const unit = 1/(frames.length + 1);
	for (let i = 0; i < frames.length; i++)
		groups.push({size: i == frames.length - 1 ? 2*unit : unit});

	let layout: any = {orientation: 1, groups};
	const retainExecutionTreePanel = executionTreePanel?.visible;
	if (retainExecutionTreePanel)
		layout = {orientation: 0, groups: [{groups}, {'groups': [{}]}]};
	await vscode.commands.executeCommand('vscode.setEditorLayout', {orientation: 1, groups});
	if (retainExecutionTreePanel)
		executionTreePanel?.reveal(groups.length + 1);

	const callerRanges: Map<vscode.TextEditor, vscode.Range[]> = new Map();
	for (let i = frames.length - 1; 0 <= i; i--) {
		const frame = frames[i];
		const [_, h, env, l, msg] = frame;
		const location = locationOfLoc(baseUri, l);
		const editor = await vscode.window.showTextDocument(location.uri, {
			viewColumn: i + 1
		});
		editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
		if (i == 0) {
			currentStatementDecorationEditor = editor;
			editor.setDecorations(currentStatementDecorationType, [location.range]);
		} else {
			let editorCallerRanges = callerRanges.get(editor);
			if (editorCallerRanges === undefined) {
				callerRanges.set(editor, editorCallerRanges = []);
				callerDecorationEditors.push(editor);
			}

			editorCallerRanges.push(location.range);
		}
	}

	for (const [editor, editorCallerRanges] of callerRanges.entries())
		editor.setDecorations(callerDecorationType, editorCallerRanges);
	
	for (const editor of vscode.window.visibleTextEditors)
		showBranchesInEditor(editor);
	
	const firstCtxt = frames[0];
	const h = firstCtxt[1];
	const env = firstCtxt[2];
	
	h.sort(([coef1, chunk1], [coef2, chunk2]) => chunk1 < chunk2 ? -1 : chunk1 > chunk2 ? 1 : coef1 < coef2 ? -1 : coef1 > coef2 ? 1 : 0);
	heapTreeViewDataProvider!.setElements(h.map(([coef, chunk]) => (coef === "1" ? "" : "[" + coef + "]") + chunk));
	localsTreeViewDataProvider!.setElements(sortedListOfEntries(env));
	if (frames.length > 1) {
		const callerEnv = frames[1][2];
		callerLocalsTreeViewDataProvider!.setElements(sortedListOfEntries(callerEnv));
	} else
		callerLocalsTreeViewDataProvider!.setElements(['N/A']);
	assumptionsTreeViewDataProvider!.setElements(step.assumptions);
}

async function showSymbolicExecutionError(baseUri: vscode.Uri, result: SymbolicExecutionError) {
	const [_, ctxts, l, msg, errorAttributes] = result;

	const [steps, lastStep] = createSteps(baseUri, ctxts);
	stepsTreeViewDataProvider?.setToplevelSteps(steps);
	stepsTreeView!.reveal(lastStep);

	await showStep(baseUri, lastStep);

	const frames = lastStep.frames;

	const infos: vscode.DiagnosticRelatedInformation[] = [];

	for (let i = frames.length - 1; 0 <= i; i--) {
		const frame = frames[i];
		const [_, h, env, l, msg] = frame;
		const location = locationOfLoc(baseUri, l);
		const diagnostic = new vscode.DiagnosticRelatedInformation(location, msg);
		infos.push(diagnostic);
	}

	diagnosticsCollection.clear();
	diagnosticsCollection.set(diagnosticsOfLocMsg(baseUri, l, msg, infos.reverse(), errorAttributes));

	setTimeout(() => vscode.commands.executeCommand('editor.action.marker.next'), 100);
}

async function showVeriFastResult(baseUri: vscode.Uri, result: VFResult) {
	clearTrace();
	switch (result[0]) {
		case 'success':
			vscode.commands.executeCommand("closeMarkersNavigation"); // Cause any existing inline problem views to disappear.
			vscode.window.showInformationMessage(result[1]);
			break;
		case 'CompilationError':
			{
				vscode.commands.executeCommand("closeMarkersNavigation"); // Cause any existing inline problem views to disappear.
				const msg = result[1];
				vscode.window.showErrorMessage(msg);
			}
			break;
		case 'StaticError':
			{
				const l = result[1];
				const msg = result[2];
				const errorAttributes = result[3];
				const diagnostics = diagnosticsOfLocMsg(baseUri, l, msg, [], errorAttributes);
				diagnosticsCollection.set(diagnostics);
				const uri = diagnostics[0][0];
				const doc = await vscode.workspace.openTextDocument(uri);
				const editor = await vscode.window.showTextDocument(doc);
				await vscode.commands.executeCommand('vscode.setEditorLayout', {orientation: 1, groups: [{}]});
				setTimeout(() => vscode.commands.executeCommand('editor.action.marker.next'), 100);
			}
			break;
		case 'SymbolicExecutionError':
			await showSymbolicExecutionError(baseUri, result);
			break;
		default:
			vscode.commands.executeCommand("closeMarkersNavigation"); // Cause any existing inline problem views to disappear.
			vscode.window.showErrorMessage(`Unrecognized VeriFast result tag: ${result[0]}`);
			break;
	}
}

let currentUseSites: null|{uris: vscode.Uri[], useSitesByPath: Map<string, UseSite[]>} = null;

function compareVFRangeAndPosition(vfrange: VFRange, position: vscode.Position): number {
	const [line, col] = vfrange;

	if (line <= position.line)
		return -1;
	else if (line - 1 == position.line) {
		if (col <= position.character)
			return -1;
		else if (col - 1 == position.character)
			return 0;
		else
			return 1;
	} else
		return 1;
}

function definitionLocationOfUseSite(useSite: UseSite): vscode.Location {
	const [useRange, defPathId, defRange] = useSite;
	const uri = currentUseSites!.uris[defPathId];
	let range;
	if (defRange.length == 3) {
		const [line, col, col2] = defRange;
		range = new vscode.Range(line - 1, col - 1, line - 1, col2 - 1);
	} else {
		const [line, col, line2, col2] = defRange;
		range = new vscode.Range(line - 1, col - 1, line2 - 1, col2 - 1);
	}
	return new vscode.Location(uri, range);
}

class VeriFastDefinitionProvider implements vscode.DefinitionProvider {
    public provideDefinition(document: vscode.TextDocument, position: vscode.Position):
			vscode.ProviderResult<vscode.Definition|vscode.DefinitionLink[]> {
		if (currentUseSites == null)
			return null;
		const documentUseSites = currentUseSites.useSitesByPath.get(document.fileName);
		if (documentUseSites) {
			const index = binarySearch(documentUseSites.length, i => compareVFRangeAndPosition(documentUseSites[i][0], position) < 0);
			if (documentUseSites[index] && compareVFRangeAndPosition(documentUseSites[index][0], position) == 0) {
				return definitionLocationOfUseSite(documentUseSites[index]);
			}
			const useSite = documentUseSites[index - 1];
			if (useSite) {
				const useRange = useSite[0];
				if (useRange.length == 3) {
					const [line, col1, col2] = useRange;
					if (compareVFRangeAndPosition([line, col2, 0], position) >= 0) {
						return definitionLocationOfUseSite(useSite);
					} else
						return null;
				} else {
					const [line1, col1, line2, col2] = useRange;
					if (compareVFRangeAndPosition([line2, col2, 0], position) >= 0) {
						return definitionLocationOfUseSite(useSite);
					} else
						return null;
				}
			} else
				return null;
		} else
			return null;
    }
}

class VeriFastCodeActionProvider implements vscode.CodeActionProvider {
	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, _token: vscode.CancellationToken): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
		const actions: vscode.CodeAction[] = [];

		for (const diagnostic of context.diagnostics) {
			if (diagnostic.source === 'VeriFast') {
				for (const quickFix of quickFixes) {
					const action = new vscode.CodeAction(quickFix.description, vscode.CodeActionKind.QuickFix);
					action.edit = new vscode.WorkspaceEdit();
					action.edit.insert(document.uri, diagnostic.range.end, quickFix.kind[2]);
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					actions.push(action);
				}
			}
		}

		return actions;
	}
}

let currentExecutionForest: {path: string, forest: ExecutionForest}|null = null;
let executionTreePanel: vscode.WebviewPanel|null = null;

async function showExecutionTree() {
	if (executionTreePanel == null) {
		executionTreePanel = vscode.window.createWebviewPanel(
			'verifast.executionTree',
			'VeriFast Execution Tree',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);
		executionTreePanel.webview.onDidReceiveMessage(targetNodePath => {
			verifyPath(currentExecutionForest!.path, undefined, targetNodePath);
		}, null, extensionContext.subscriptions);
		const scriptUri = vscode.Uri.file(path_.join(extensionContext.extensionPath, 'webviews/out/executionTreePanel.js'));
		executionTreePanel.webview.html = `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>VeriFast Execution Tree</title>
			<style>
				//* { margin:0; padding:0; }
				//html, body { width:100%; height:100%; }
			</style>
		</head>
		<body>
		    <table>
			<tr><td><select id="selectBox"></select></td></tr>
			<tr><td><canvas id="canvas"></canvas></td></tr>
			</table>
			<script src="${executionTreePanel.webview.asWebviewUri(scriptUri)}"></script>
		</body>
		</html>`;
		
		executionTreePanel.onDidDispose(() => executionTreePanel = null, null, extensionContext.subscriptions);
		if (currentExecutionForest != null)
			executionTreePanel.webview.postMessage(currentExecutionForest.forest);
		// executionTreePanel.onDidChangeViewState(event => {
		// 	if (executionTreePanel?.visible && currentExecutionForest != null)
		// 		executionTreePanel.webview.postMessage(currentExecutionForest);
		// });
	} else
		executionTreePanel.reveal();
}

async function showVeriFastOutput(output: any, path: string, inTargetNodeMode: boolean) {
	const baseUri = vscode.Uri.file(path_.dirname(path));

	if (output[0] != 'VeriFast-Json') {
		await showVeriFastResult(baseUri, output);
		return;
	}
	const [protocolName, majorVersion, minorVersion, data] = output;
	if (majorVersion != 2) {
		vscode.window.showErrorMessage('This version of the VeriFast VSCode extension is out of date with respect to the version of VeriFast. Please update the VeriFast VSCode extension.');
		return;
	}
	const {result, useSites, executionForest} = data as {result: VFResult, useSites: [string, UseSite[]][], executionForest: ExecutionForest};

	await showVeriFastResult(baseUri, result);

	const useSites1 = useSites.map<[vscode.Uri, UseSite[]]>(([p, sites]) => [path_.isAbsolute(p) ? vscode.Uri.file(p) : vscode.Uri.joinPath(baseUri, p), sites]);
	const useSites2 = useSites1.map<[string, UseSite[]]>(([uri, sites]) => [uri.fsPath, sites]);
	const useSitesByPath = new Map<string, UseSite[]>(useSites2);
	
	currentUseSites = {uris: useSites1.map(([uri]) => uri), useSitesByPath};
	if (!inTargetNodeMode) {
		currentExecutionForest = {path, forest: executionForest};
		if (executionTreePanel != null && executionTreePanel.visible)
			executionTreePanel.webview.postMessage(currentExecutionForest.forest);
	}
}

async function verify(runToCursor?: boolean, verifyFunction?: boolean) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		await vscode.window.showErrorMessage('No active editor');
		return;
	}
	await vscode.commands.executeCommand('workbench.action.files.saveAll');
	const path = editor.document.fileName;
	if (!(path.endsWith(".c") || path.endsWith(".cpp") || path.endsWith(".java") || path.endsWith(".jarsrc") || path.endsWith(".rs"))) {
		await vscode.window.showErrorMessage('Active file is not a .c, .cpp, .java, .jarsrc, or .rs file');
		return;
	}

	verifyPath(path,
		runToCursor ? editor.document.fileName + ":" + (editor.selection.active.line + 1) : undefined,
		undefined,
		verifyFunction ? editor.document.fileName + ":" + (editor.selection.active.line + 1) : undefined);
}

function findCargoPackageRoot(path: string) {
	if (!path.endsWith('.rs') && !path.endsWith('/Cargo.toml'))
		return null;

	for (;;) {
		const lastSlashIndex = path.lastIndexOf("/");
		assert(0 <= lastSlashIndex); // We assume we get an absolute path
		path = path.substring(0, lastSlashIndex);
		if (fs.existsSync(path + '/Cargo.toml'))
			return path + '/';
		if (path == "")
			return null;
	}
}

interface RustcDiagnosticSpan {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	file_name: string; // Relative wrt cargo package root
	// eslint-disable-next-line @typescript-eslint/naming-convention
	line_start: number; // 1-based
	// eslint-disable-next-line @typescript-eslint/naming-convention
	column_start: number; // 1-based
	// eslint-disable-next-line @typescript-eslint/naming-convention
	line_end: number; // Last line
	// eslint-disable-next-line @typescript-eslint/naming-convention
	column_end: number; // Exclusive
}

interface RustcDiagnostic {
	level: string;
	message: string;
	spans: RustcDiagnosticSpan[];
}

async function showRustcDiagnostic(baseUri: vscode.Uri, rustcDiagnostic: RustcDiagnostic) {
	diagnosticsCollection.clear();
	clearDecorations();
	const span = rustcDiagnostic.spans[0];
	const canonicalPath =
		path_.isAbsolute(span.file_name) ?
			vscode.Uri.file(span.file_name)
		:
			vscode.Uri.joinPath(baseUri, span.file_name);
	const range = new vscode.Range(span.line_start - 1, span.column_start - 1, span.line_end - 1, span.column_end - 1);
	const location = new vscode.Location(canonicalPath, range);
	const diagnostic = new vscode.Diagnostic(location.range, rustcDiagnostic.message);
	diagnostic.source = "rustc via VeriFast";
	diagnosticsCollection.set([[location.uri, [diagnostic]]]);
	const doc = await vscode.workspace.openTextDocument(location.uri);
	const editor = await vscode.window.showTextDocument(doc);
	await vscode.commands.executeCommand('vscode.setEditorLayout', {orientation: 1, groups: [{}]});
	setTimeout(() => vscode.commands.executeCommand('editor.action.marker.next'), 100);
}

function getPATHEnvironmentVariableName(env: NodeJS.ProcessEnv) {
	// On Windows, the PATH environment variable must be matched case-insensitively
	if ('PATH' in env)
		return 'PATH';
	for (const key in env) {
		if (key.toLowerCase() == 'path')
			return key;
	}
	return 'PATH';
}

function addPATH(env: NodeJS.ProcessEnv, path: string) {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	const PATHEnvVarName = getPATHEnvironmentVariableName(env);
	env[PATHEnvVarName] = path + path_.delimiter + env[PATHEnvVarName];
}

async function verifyPathWithCargo(cargoPackageRoot: string, breakpoint?: string, targetNodePath?: string, focus?: string) {
	const verifastBin = path_.dirname(await getVeriFastCommandPath());

	const vfProcessArgs = ["verifast", "-json", "-c", "-allow_assume", "-allow_should_fail", "-read_options_from_source_file", "-allow_dead_code"];
	if (breakpoint) {
		vfProcessArgs.push("-breakpoint", breakpoint);
	} else if (targetNodePath) {
		vfProcessArgs.push("-break_at_node", targetNodePath);
	} else if (focus) {
		vfProcessArgs.push("-focus", focus);
	}
	const env = {...process.env};
	addPATH(env, verifastBin);

	const vfProcess = child_process.spawn("cargo", vfProcessArgs, {
		cwd: cargoPackageRoot,
		env
	});
	vfProcess.stdin.end(); // If future versions of VeriFast wait for input, ensure they don't wait forever.

	console.log(`Spawned 'cargo' with arguments ${JSON.stringify(vfProcessArgs)}`);

	const processFinished = new Promise((resolve, _) => {
		const stdoutLines = readline.createInterface({
			input: vfProcess.stdout,
			crlfDelay: Infinity
		});
		stdoutLines.on('line', async (line) => {
			if (line.startsWith('{"reason"')) {
				const cargoMessage = JSON.parse(line);
				if (cargoMessage.reason === 'compiler-message' && cargoMessage.message.level === 'error') {
					resolve(undefined);
					stdoutLines.removeAllListeners();
					vfProcess.removeAllListeners();
					await showRustcDiagnostic(vscode.Uri.file(cargoPackageRoot), cargoMessage.message);
					return;
				}
			}
			if (!line.startsWith('["VeriFast-Json"') && !line.startsWith('{"result"'))
				return;
			resolve(undefined);
			let result;
			try {
				result = JSON.parse(line);
			} catch (ex) {
				await vscode.window.showErrorMessage(`Failed to parse VeriFast output '${line}': ${ex}`);
				return;
			}
			await showVeriFastOutput(result, cargoPackageRoot + "/Cargo.toml", targetNodePath !== undefined);
		});

		let stderr = "";
		
		vfProcess.stderr.on('data', (data) => {
			console.error(`stderr: ${data}`);
			stderr += data;
		});
		
		vfProcess.on('exit', (code, signal) => {
			resolve(undefined);
			console.log(`child process exited with code ${code} and signal ${signal}`);
			if (code != 0) {
				let signalText = signal == null ? "" : ` and signal '${signal}'`;
				let stderrText = stderr == "" ? "." : `: '${stderr}'`;
				vscode.window.showErrorMessage(`The 'cargo verifast' process terminated with error code ${code}${signalText}${stderrText}`);
			}
		});

		vfProcess.on('error', (error) => {
			resolve(undefined);
			console.log(`ChildProcess object raised event 'error' with payload ${error}`);
			vscode.window.showErrorMessage(`Could not launch the 'cargo verifast' process: '${error}'.`);
		});
	});

	const timeout = setTimeout(() => {
		vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: "Running 'cargo verifast'..."}, () => {
			return processFinished;
		});
	}, 500);

	processFinished.then(() => clearTimeout(timeout));
}

async function getVeriFastCommandPath() {
	const config = vscode.workspace.getConfiguration('verifast');
	const verifastExecutable = config.verifastCommandPath;
	if (verifastExecutable == null || (""+verifastExecutable).trim() == "") {
		if (await vscode.window.showErrorMessage('Please configure the path to the VeriFast command.', 'Open Settings') == 'Open Settings')
			vscode.commands.executeCommand('workbench.action.openSettings', 'verifast');
		return;
	}

	if (!fs.existsSync(verifastExecutable)) {
		if (await vscode.window.showErrorMessage(`The configured VeriFast command does not exist: '${verifastExecutable}'.`, 'Open Settings') == 'Open Settings')
			vscode.commands.executeCommand('workbench.action.openSettings', 'verifast');
		return;
	}

	return verifastExecutable;
}

async function verifyPath(path: string, breakpoint?: string, targetNodePath?: string, focus?: string) {
	const cargoPackageRoot = findCargoPackageRoot(path);
	if (cargoPackageRoot !== null) {
		await verifyPathWithCargo(cargoPackageRoot, breakpoint, targetNodePath, focus);
		return;
	}

	const verifastExecutable = await getVeriFastCommandPath();

	const vfProcessArgs = ["-json", "-c", "-allow_assume", "-allow_should_fail", "-read_options_from_source_file", "-allow_dead_code"];
	if (breakpoint) {
		vfProcessArgs.push("-breakpoint", breakpoint);
	} else if (targetNodePath) {
		vfProcessArgs.push("-break_at_node", targetNodePath);
	} else if (focus) {
		vfProcessArgs.push("-focus", focus);
	}
	vfProcessArgs.push(path);
	const vfProcess = child_process.spawn(verifastExecutable, vfProcessArgs);
	vfProcess.stdin.end(); // If future versions of VeriFast wait for input, ensure they don't wait forever.

	console.log(`Spawned '${verifastExecutable}' with arguments ${JSON.stringify(vfProcessArgs)}`);

	const processFinished = new Promise((resolve, _) => {
		const stdoutLines = readline.createInterface({
			input: vfProcess.stdout,
			crlfDelay: Infinity
		});
		stdoutLines.once('line', async (line) => {
			resolve(undefined);
			let result;
			try {
				result = JSON.parse(line);
			} catch (ex) {
				await vscode.window.showErrorMessage(`Failed to parse VeriFast output '${line}': ${ex}`);
				return;
			}
			await showVeriFastOutput(result, path, targetNodePath !== undefined);
		});

		let stderr = "";
		
		vfProcess.stderr.on('data', (data) => {
			console.error(`stderr: ${data}`);
			stderr += data;
		});
		
		vfProcess.on('exit', (code, signal) => {
			resolve(undefined);
			console.log(`child process exited with code ${code} and signal ${signal}`);
			if (code != 0) {
				let signalText = signal == null ? "" : ` and signal '${signal}'`;
				let stderrText = stderr == "" ? "." : `: '${stderr}'`;
				vscode.window.showErrorMessage(`The Verifast process terminated with error code ${code}${signalText}${stderrText}`);
			}
		});

		vfProcess.on('error', (error) => {
			resolve(undefined);
			console.log(`ChildProcess object raised event 'error' with payload ${error}`);
			vscode.window.showErrorMessage(`Could not launch the VeriFast process: '${error}'.`);
		});
	});

	const timeout = setTimeout(() => {
		vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: 'Running VeriFast...'}, () => {
			return processFinished;
		});
	}, 500);

	processFinished.then(() => clearTimeout(timeout));
}

export function activate(context: vscode.ExtensionContext) {

	extensionContext = context;

	context.subscriptions.push(
		currentStatementDecorationType,
		callerDecorationType,
		leftBranchDecorationType,
		rightBranchDecorationType);

	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			['c', 'cpp', 'verifast_ghost_header', 'rust'],
			new VeriFastDefinitionProvider()));

	diagnosticsCollection = vscode.languages.createDiagnosticCollection('verifast');
	context.subscriptions.push(diagnosticsCollection);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			['c', 'cpp', 'verifast_ghost_header', 'rust'],
			new VeriFastCodeActionProvider(),
			{
                providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
            }));

	heapTreeViewDataProvider = new StringTreeDataProvider(['N/A']);
	heapTreeView = vscode.window.createTreeView('verifast.heap', {
		treeDataProvider: heapTreeViewDataProvider
	});

	localsTreeViewDataProvider = new StringTreeDataProvider(['N/A']);
	localsTreeView = vscode.window.createTreeView('verifast.locals', {
		treeDataProvider: localsTreeViewDataProvider
	});

	callerLocalsTreeViewDataProvider = new StringTreeDataProvider(['N/A']);
	callerLocalsTreeView = vscode.window.createTreeView('verifast.callerLocals', {
		treeDataProvider: callerLocalsTreeViewDataProvider
	});

	assumptionsTreeViewDataProvider = new StringTreeDataProvider(['N/A']);
	assumptionsTreeView = vscode.window.createTreeView('verifast.assumptions', {
		treeDataProvider: assumptionsTreeViewDataProvider
	});

	stepsTreeViewDataProvider = new StepTreeDataProvider([]);
	stepsTreeView = vscode.window.createTreeView('verifast.steps', {
		treeDataProvider: stepsTreeViewDataProvider
	});

	context.subscriptions.push(vscode.commands.registerCommand('verifast.verify', verify));
	context.subscriptions.push(vscode.commands.registerCommand('verifast.showStep', showStep));
	context.subscriptions.push(vscode.commands.registerCommand('verifast.clearTrace', clearTrace));
	context.subscriptions.push(vscode.commands.registerCommand('verifast.runToCursor', () => verify(true)));
	context.subscriptions.push(vscode.commands.registerCommand('verifast.verifyFunction', () => verify(false, true)));
	context.subscriptions.push(vscode.commands.registerCommand('verifast.showExecutionTree', showExecutionTree));
}

export function deactivate() {}
