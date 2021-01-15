/* eslint-disable eqeqeq */
/* eslint-disable curly */
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as readline from 'readline';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import { getCallStack, Loc, SymbolicExecutionError, VFContext, VFResult } from './verifast';

function sortedListOfEntries(o: {[index: string]: string}) {
	const entries = Object.entries(o).map(([key, value]) => key + ": " + value);
	entries.sort();
	return entries;
}

function locationOfLoc(l: Loc): vscode.Location {
	switch (l[0]) {
		case 'Lexed':
			const [[startPath, startLine, startCol], [endPath, endLine, endCol]] = l[1];
			assert(startPath === endPath);
			const canonicalPath = vscode.Uri.file(startPath);
			const range = new vscode.Range(startLine - 1, startCol - 1, endLine - 1, endCol - 1);
			return new vscode.Location(canonicalPath, range);
		default:
			assert(false);
	}
}

function diagnosticsOfLocMsg(l: Loc, msg: string, info: vscode.DiagnosticRelatedInformation[]): [vscode.Uri, vscode.Diagnostic[]][] {
	switch (l[0]) {
		case 'Lexed':
			const location = locationOfLoc(l);
			const diagnostic = new vscode.Diagnostic(location.range, msg);
			diagnostic.source = "VeriFast";
			diagnostic.relatedInformation = info;
			return [[location.uri, [diagnostic]]];
		default:
			assert(false);
	}
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

let extensionContext: vscode.ExtensionContext;

let currentStatementDecorationType: vscode.TextEditorDecorationType|null = null;
let callerDecorationType: vscode.TextEditorDecorationType|null = null;

let heapTreeView: vscode.TreeView<string>|null = null;
let heapTreeViewDataProvider: StringTreeDataProvider|null = null;

let localsTreeView: vscode.TreeView<string>|null = null;
let localsTreeViewDataProvider: StringTreeDataProvider|null = null;

let callerLocalsTreeView: vscode.TreeView<string>|null = null;
let callerLocalsTreeViewDataProvider: StringTreeDataProvider|null = null;

let assumptionsTreeView: vscode.TreeView<string>|null = null;
let assumptionsTreeViewDataProvider: StringTreeDataProvider|null = null;

let diagnosticsCollection: vscode.DiagnosticCollection;

async function showSymbolicExecutionError(result: SymbolicExecutionError) {
	const [_, ctxts, l, msg, url] = result;
	const frames = getCallStack(ctxts);

	await vscode.commands.executeCommand('workbench.view.extension.verifast');

	const groups = [];
	const unit = 1/(frames.length + 1);
	for (let i = 0; i < frames.length; i++)
		groups.push({size: i == frames.length - 1 ? 2*unit : unit});

	await vscode.commands.executeCommand('vscode.setEditorLayout', {orientation: 1, groups});

	const infos: vscode.DiagnosticRelatedInformation[] = [];

	if (callerDecorationType != null) {
		callerDecorationType.dispose();
		callerDecorationType = null;
	}
	for (let i = frames.length - 1; 0 <= i; i--) {
		const frame = frames[i];
		const [_, h, env, l, msg] = frame;
		const location = locationOfLoc(l);
		const diagnostic = new vscode.DiagnosticRelatedInformation(location, msg);
		infos.push(diagnostic);
		const editor = await vscode.window.showTextDocument(location.uri, {
			viewColumn: i + 1
		});
		editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
		if (i == 0) {
			if (currentStatementDecorationType != null) {
				currentStatementDecorationType.dispose();
				// TODO: Remove from context.subscriptions?
			}

			currentStatementDecorationType = vscode.window.createTextEditorDecorationType({
				backgroundColor: "#FFFF00"
			});
			extensionContext.subscriptions.push(currentStatementDecorationType);
		
			editor.setDecorations(currentStatementDecorationType, [location.range]);
		} else {
			if (callerDecorationType == null) {
				callerDecorationType = vscode.window.createTextEditorDecorationType({
					backgroundColor: "#00FF00"
				});
				extensionContext.subscriptions.push(callerDecorationType);
			}

			editor.setDecorations(callerDecorationType, [location.range]);
		}
	}

	diagnosticsCollection.clear();
	diagnosticsCollection.set(diagnosticsOfLocMsg(l, msg, infos.reverse()));

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
	assumptionsTreeViewDataProvider!.setElements(Array.prototype.concat(...ctxts.map((ctxt: VFContext) => ctxt[0] == 'Assuming' ? [ctxt[1]] : [])));
	setTimeout(() => vscode.commands.executeCommand('editor.action.marker.next'), 100);
}

async function showVeriFastResult(result: VFResult) {
	switch (result[0]) {
		case 'success':
			vscode.window.showInformationMessage(result[1]);
			break;
		case 'CompilationError':
			{
				const msg = result[1];
				vscode.window.showErrorMessage(msg);
			}
			break;
		case 'StaticError':
			{
				const l = result[1];
				const msg = result[2];
				diagnosticsCollection.clear();
				diagnosticsCollection.set(diagnosticsOfLocMsg(l, msg, []));
				if (currentStatementDecorationType != null) {
					currentStatementDecorationType.dispose();
					currentStatementDecorationType = null;
					// TODO: Remove from context.subscriptions?
				}
				if (callerDecorationType != null) {
					callerDecorationType.dispose();
					callerDecorationType = null;
				}
				await vscode.commands.executeCommand('vscode.setEditorLayout', {orientation: 1, groups: [{}]});
				setTimeout(() => vscode.commands.executeCommand('editor.action.marker.next'), 100);
			}
			break;
		case 'SymbolicExecutionError':
			await showSymbolicExecutionError(result);
			break;
		default:
			vscode.window.showErrorMessage(`Unrecognized VeriFast result tag: ${result[0]}`);
			break;
	}
}

async function verify() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		await vscode.window.showErrorMessage('No active editor');
		return;
	}
	await vscode.commands.executeCommand('workbench.action.files.saveAll');
	const path = editor.document.fileName;
	if (!(path.endsWith(".c") || path.endsWith(".java") || path.endsWith(".jarsrc"))) {
		await vscode.window.showErrorMessage('Active file is not a .c, .java, or .jarsrc file');
		return;
	}

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

	const vfProcessArgs = ["-json", "-c", "-allow_should_fail", "-read_options_from_source_file", path];
	const vfProcess = child_process.spawn(verifastExecutable, vfProcessArgs);
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
			await showVeriFastResult(result);
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

	diagnosticsCollection = vscode.languages.createDiagnosticCollection('verifast');
	context.subscriptions.push(diagnosticsCollection);

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

	let disposable = vscode.commands.registerCommand('verifast.verify', verify);

	context.subscriptions.push(disposable);
}

export function deactivate() {}
