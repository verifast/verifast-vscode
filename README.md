# VeriFast

[VeriFast](https://github.com/verifast/verifast) is a research prototype of a modular formal verification tool for C and Java programs. It takes as input a `.c` or `.java` file annotated with function/method preconditions and postconditions, loop invariants, data structure descriptions, mathematical definitions, and proof hints, and symbolically executes each function/method, using a separation logic-based representation of memory, to check that it complies with its specification. If the tool reports "0 errors found" then, barring bugs in the tool, this means that every possible execution of the program is free of illegal memory accesses and data races and complies with the provided specifications.

This extension provides support for running VeriFast from Visual Studio Code.

## Features

Issue the **Verify with VeriFast** command (bound by default to Shift+Alt+V) to run VeriFast on the active `.c` or `.java` file. If VeriFast encounters a symbolic execution failure, the symbolic state at the time of failure is shown in the sidebar, and both the source location of the failure and the call site (if applicable) are highlighted and shown.

![Heartbleed example](screenshot.png)

To set command-line options, specify them on the first line of your `.c` or `.java` file. For example:

```c
// verifast_options{disable_overflow_check prover:z3v4.5 target:Linux64}
```

Other commands:
- **Verify function with VeriFast** (Shift+Alt+M)
- **VeriFast: Run to cursor** (Shift+Alt+C)
- **Clear VeriFast trace** (Shift+Alt+L)
- **Show VeriFast execution tree** (Shift+Alt+T)

## Requirements

You need to install VeriFast itself separately. This extension requires version verifast-21.04-125-g607ce955
 (created 2022-12-12) or newer. Download the [latest nightly build](https://github.com/verifast/verifast#binaries), extract it to any location on your machine, and configure the path to the VeriFast command in your VSCode settings (Settings -> Extensions -> VeriFast).

## Extension Settings

This extension contributes the following settings:

* `verifast.verifastCommandPath`: path to the VeriFast command-line tool

## Syntax Highlighting for VeriFast Annotations

To get proper syntax highlighting for VeriFast annotations, insert the following into your `settings.json` file (Preferences -> Settings -> Open Settings (JSON)):
```json
    "editor.tokenColorCustomizations": {
        "textMateRules": [
            {
                "scope": "verifast-ghost-range",
                "settings": {
                    "foreground": "#CC6600"
                }
            },
            {
                "scope": "verifast-ghost-keyword",
                "settings": {
                    "fontStyle": "bold",
                    "foreground": "#DB9900"
                }
            },
            {
                "scope": "verifast-ghost-range-delimiter",
                "settings": {
                    "foreground": "#808080"
                }
            }
        ],
    }
```

## Known Issues

Known TODO items:
- Browse VeriFast built-in header files
- Code completion inside annotations

## Release Notes

### 0.9.1 - 2022-12-12

Added the **Verify function with VeriFast** command.

Fixed [crashes due to dead code errors](https://github.com/verifast/verifast-vscode/issues/2).

### 0.9.0 - 2022-12-01

Added the Steps view, branch decorations, syntax highlighting of annotations, and the **VeriFast: Run to cursor**, **Clear VeriFast trace** and **Show VeriFast execution tree** commands. Also, VeriFast now supports specifying most relevant command-line options on the first line of the source file.

### 0.2.0 - 2021-01-21

Added *Go to Definition* support. Requires support from VeriFast, so make sure to use the latest VeriFast build.

### 0.1.0 - 2021-01-15

Initial release.