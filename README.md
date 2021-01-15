# VeriFast

[VeriFast](https://github.com/verifast/verifast) is a research prototype of a modular formal verification tool for C and Java programs. It takes as input a `.c` or `.java` file annotated with function/method preconditions and postconditions, loop invariants, data structure descriptions, mathematical definitions, and proof hints, and symbolically executes each function/method, using a separation logic-based representation of memory, to check that it complies with its specification. If the tool reports "0 errors found" then, barring bugs in the tool, this means that every possible execution of the program is free of illegal memory accesses and data races and complies with the provided specifications.

This extension provides basic support for running VeriFast from Visual Studio Code.

## Features

Issue the **Verify with VeriFast** command (bound by default to Shift+Alt+V) to run VeriFast on the active `.c` or `.java` file. If VeriFast encounters a symbolic execution failure, the symbolic state at the time of failure is shown in the sidebar, and both the source location of the failure and the call site (if applicable) are highlighted and shown.

![Heartbleed example](screenshot.png)

To set the `-disable_overflow_check`, `-prover`, or `-target` command-line options, specify them on the first line of your `.c` or `.java` file. For example:

```c
// verifast_options{disable_overflow_check prover:z3v4.5 target:Linux64}
```

## Requirements

You need to install VeriFast itself separately. This extension requires a recent build (built after 2021-01-15). Download the [latest nightly build](https://github.com/verifast/verifast#binaries), extract it to any location on your machine, and configure the path to the VeriFast command in your VSCode settings (Settings -> Extensions -> VeriFast).

## Extension Settings

This extension contributes the following settings:

* `verifast.verifastCommandPath`: path to the VeriFast command-line tool

## Known Issues

Known TODO items:
- Allow stepping through the symbolic execution trace
- Allow viewing the entire symbolic execution tree
- Go to Definition
- Browse VeriFast built-in header files
- Syntax highlighting, code completion inside annotations

## Release Notes

### 0.1.0

Initial release.