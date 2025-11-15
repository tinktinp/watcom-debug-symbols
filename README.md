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

## cspec

The [watcall cspec file](./cspecs/__watcall.xml) is a really simple Ghidra cspec file that I created. IIRC, I started by exporting the `fastcall` one. 

You can import it using `Edit`➡️`Options for <YourProgram.exe>`➡️`Specification Extensions`

The python script does not use it. The Watcom debug symbols specify exactly which registers were used to call the function, so I am not sure whether or not it provides value. (Also I created it after I wrote the script and already did the import.)

However, most binaries will have some parts that without debug symbols, and so it can be useful to apply this calling convention ot those parts. It also just bugs me a little to see `fastcall` or `unknown` for functions I know are `watcall`.

### other watcall cspec files

There are some more complete watall cspec files attached to this github issue: https://github.com/NationalSecurityAgency/ghidra/issues/156

There's also some debate about how correct they are. I don't remember exactly why I went with creating my own simpler one. 

## Notes on Ghidra and Cutter (Rizin)

### Ghidra flaws

Ghidra doesn't have built in support for Watcom or "Linear Executable" files, so I had to use the [extension](https://github.com/yetmorecode/ghidra-lx-loader) as described above.

Ghidra's decompiler doesn't seem to work well with this style of 32bit x86 assembler. Or perhaps my script doesn't load the debug symbols correctly.

- Once this script creates parameters and assigns them types, the disassembler view in Ghidra shows the registers as those parameters, even after they get reassigned!
    - So you see `param1` instead of `EAX` everywhere
    - my understanding is that Ghidra is supposed to handle this automatically, and sometimes it does but mostly seems to not, and I could not find a way to explicitly tell it
- Ghidra's decompiler has seemingly the opposite problem: each time a stack variable is copied to a register, it creates a new local variable!
    - But that's how the stack variables get used, they get copied to a register, manipulated, then copied back (if this is a mutation) or copied somewhere else (for some expression or assignment)
    - So you have to keep renaming these new variables to the original name plus an underscore or something, because you can't have two locals with the same name
    - Because this locals usually live in registers, this renames the register yet again in the assembly view, making that problem worse

### Cutter (Rizin)

Eventually I got frustrated and decided to use [Cutter](https://github.com/rizinorg/cutter), which is the GUI for [Rizin](https://github.com/rizinorg/rizin). Unfortunately my scripts don't have any support for Rizin at this time, so I had to manually enter the symbols I was interested in.

I'll say "Cutter" here, but know that most of what I say is really about Rizin. But since I mostly used it from Cutter, if anything is Cutter specific I might not realize it.

For some reason, Cutter and Ghidra don't agree on the offsets of the local variables (relative to `EBP`), which made manually copying things over confusing. 

Cutter does have built in support for Linear Executables. So that part was made easier.

Cutter can use Ghidra's decompiler. I tried that, but it had the same flaws as Ghidra's decompiler running in Ghidra. 

I did find Cutter's [jsdec](https://github.com/rizinorg/jsdec) to be useful. It's lower level than Ghidra's decompiler. For the most part, it shows the registers as the registers, and the stack variables by the names I gave them. So you do still have to read though the stack->register->manipulation->back-to-stack and mentally simplify it. (Or copy/paste to a file and manually simplify it.)

Because it closely followed the assembly, I was able to have more confidence that the output was correct, and more easily compare. It turns most jumps into `goto`s, and doesn't try to do `switch` statements, but at least it does `if` statements. 

To be fair, there are plenty of places where I find Ghidra more useful and more understandable.

### ImHex

I also found [ImHex](https://github.com/WerWolv/ImHex) and its [Pattern Language](https://docs.werwolv.net/pattern-language) very useful.
I found myself wishing that Ghidra or Cutter also supported it. 

I have some of the patterns I've created in their own repo at https://github.com/tinktinp/hexpat



## References

- https://open-watcom.github.io/open-watcom-v2-wikidocs/wddoc.html