# watcom-debug-symbols

This repo contains some scripts to extract Watcom debugging symbols from
an executable into a JSON file.

It also contains a script to parse this JSON file and load those symbols
into Ghidra.

Currently it supports most symbols except for source lines.

## Usage

### main script

There's a main script that takes a single argument and writes json to stdout.

Make sure you're using node v24 and have pnpm installed (or have corepack enabled).

First install dependencies:

```sh
pnpm install
```

Then you can run the script:

```sh
node ./src/main.ts /path/to/some/file > results.json
```

Most of the code in the `src/` file is in support of this main export script.

### ghidra script

There is also a `src/ImportWatcomSymbolsScript.py` based on based in part on the "ImportSymbolsScript.py" example from Ghidra.

This was only lightly tested and only with Ghidra 11.4.2

You'll see a Ghidra extension for Lx binaries too. There's a couple. I think I used the "yetmorecode" one.

- https://github.com/yetmorecode/ghidra-lx-loader
- https://github.com/oshogbo/ghidra-lx-loader

Note that the script, when processing the global symbol table, uses the symbol name to decide if the symbol is code or data. I found that some data was marked as code, so I ignored the code flag. Maybe that was a mistake though, since it was usually correct. 

You will likely also find it helpful to download some of the OpenWatcom code. You might want to have Ghidra scan some of its headers to get symbols for the Watcom stdlib.

## References

- https://open-watcom.github.io/open-watcom-v2-wikidocs/wddoc.html