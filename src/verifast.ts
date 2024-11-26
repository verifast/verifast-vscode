/* eslint-disable eqeqeq */
export type SrcPos = [string, number, number];
export type Loc0 = [SrcPos, SrcPos];
export type LexedLoc = ['Lexed', Loc0];
export type DummyLoc = ['DummyLoc'];
export type MacroExpansionLoc = ['MacroExpansion', Loc, Loc];
export type MacroParameterExpansionLoc = ['MacroParameterExpansion', Loc, Loc];
export type Loc = LexedLoc | DummyLoc | MacroExpansionLoc | MacroParameterExpansionLoc;

export type Term = string;
export type Heap = Term[];
export type Env = {[varName: string]: Term};
export type Message = string;
export type AssumingCtxt = ['Assuming', Term];
export type ExecutingCtxt = ['Executing', Heap, Env, Loc, Message];
export type BranchKind = 'LeftBranch'|'RightBranch';
export type VFContext =
  | AssumingCtxt
  | ExecutingCtxt
  | ['PushSubcontext']
  | ['PopSubcontext']
  | ['Branching', BranchKind]
  ;

export type RustcDiagnostic = unknown;

export type QuickFixKind = ['InsertTextAt', SrcPos, string];

export type QuickFix = {
  description: string;
  kind: QuickFixKind;
};

export type ErrorAttributes = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  help_topic?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  quick_fixes?: QuickFix[];
  // eslint-disable-next-line @typescript-eslint/naming-convention
  rustc_diagnostics?: RustcDiagnostic[];
};

export type SuccessResult = ['success', Message];
export type CompilationError = ['CompilationError', Message];
export type StaticError = ['StaticError', Loc, Message, ErrorAttributes];
export type SymbolicExecutionError = ['SymbolicExecutionError', VFContext[], Loc, Message, ErrorAttributes];
export type VFResult =
  | SuccessResult
  | CompilationError
  | StaticError
  | SymbolicExecutionError
  ;

export type VFRange = [number, number, number] | [number, number, number, number];
export type UseSite = [VFRange, number, VFRange];
export type ExecutionForest = {msgs: string[], forest: string};