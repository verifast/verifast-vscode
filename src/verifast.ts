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
export type VFContext =
  | AssumingCtxt
  | ExecutingCtxt
  | ['PushSubcontext']
  | ['PopSubcontext']
  | ['Branching', 'LeftBranch'|'RightBranch']
  ;

export type SuccessResult = ['success', Message];
export type CompilationError = ['CompilationError', Message];
export type StaticError = ['StaticError', Loc, Message];
export type SymbolicExecutionError = ['SymbolicExecutionError', VFContext[], Loc, Message, string|null];
export type VFResult =
  | SuccessResult
  | CompilationError
  | StaticError
  | SymbolicExecutionError
  ;

export function getCallStack(ctxts: VFContext[]): ExecutingCtxt[] {
	const stack: (ExecutingCtxt|null)[] = [null];
	for (let i = ctxts.length - 1; 0 <= i; i--) {
		const ctxt = ctxts[i];
		switch (ctxt[0]) {
			case 'Executing':
				stack[stack.length - 1] = ctxt;
				break;
			case 'PushSubcontext':
				stack.push(null);
				break;
			case 'PopSubcontext':
				stack.pop();
				break;
			case 'Assuming':
				break;
			case 'Branching':
				break;
		}
	}
	return Array.prototype.concat(...stack.map(ctxt => ctxt == null ? [] : [ctxt])).reverse();
}

export type VFRange = [number, number, number] | [number, number, number, number];
export type UseSite = [VFRange, number, VFRange];
