import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Each group shares [immediate bytes, pops, pushes]. Unlisted bytes are invalid.
const shapes = [];
for (const [shape, opcodes] of [
  [[0, 0, 0], [0x00, 0x34]],
  [[1, 0, 1], [0x01]],
  [[4, 0, 1], [0x02]],
  [[0, 1, 0], [0x03, 0x50, 0x51, 0x53]],
  [[0, 1, 2], [0x04]],
  [[0, 2, 2], [0x05]],
  [[0, 2, 3], [0x06]],
  [[0, 3, 3], [0x07]],
  [[0, 2, 1], [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19,
               0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22]],
  [[0, 1, 1], [0x17, 0x1b, 0x40]],
  [[2, 0, 0], [0x30, 0x33]],
  [[2, 1, 0], [0x31, 0x32]],
  [[0, 2, 0], [0x41]],
  [[0, 0, 1], [0x52]],
]) {
  for (const opcode of opcodes) shapes[opcode] = shape;
}

function run(program, input) {
  const stack = new Int32Array(256);
  const memory = new Int32Array(256);
  const calls = new Int32Array(64);
  const output = Buffer.alloc(65_536);
  let sp = 0;
  let depth = 0;
  let pc = 0;
  let read = 0;
  let written = 0;
  const finish = code => [output.subarray(0, written), code];

  for (let steps = 0; steps < 1_000_000; steps++) {
    if (pc < 0 || pc >= program.length) return finish(9);
    const op = program[pc];
    const shape = shapes[op];
    if (!shape) return finish(5);
    const [imm, pops, pushes] = shape;
    const arg = pc + 1;
    pc = arg + imm;
    if (pc > program.length) return finish(9);
    if (sp < pops) return finish(2);
    if (sp - pops + pushes > stack.length) return finish(3);

    const b = pops >= 1 ? stack[sp - 1] : 0;
    const a = pops >= 2 ? stack[sp - 2] : 0;
    if (op >= 0x13 && op <= 0x16 && b === 0) return finish(4);
    switch (op) {
      case 0x00: return finish(0);
      case 0x01: stack[sp++] = program.readInt8(arg); break;
      case 0x02: stack[sp++] = program.readInt32LE(arg); break;
      case 0x03: sp--; break;
      case 0x04: stack[sp++] = b; break;
      case 0x05:
        stack[sp - 2] = b;
        stack[sp - 1] = a;
        break;
      case 0x06: stack[sp++] = a; break;
      case 0x07: {
        const bottom = stack[sp - 3];
        stack[sp - 3] = a;
        stack[sp - 2] = b;
        stack[sp - 1] = bottom;
        break;
      }
      // Int32Array stores wrap to 32 bits and truncate division toward zero.
      case 0x10: stack[--sp - 1] = a + b; break;
      case 0x11: stack[--sp - 1] = a - b; break;
      case 0x12: stack[--sp - 1] = Math.imul(a, b); break;
      case 0x13: stack[--sp - 1] = a / b; break;
      case 0x14: stack[--sp - 1] = a % b; break;
      case 0x15: stack[--sp - 1] = (a >>> 0) / (b >>> 0); break;
      case 0x16: stack[--sp - 1] = (a >>> 0) % (b >>> 0); break;
      case 0x17: stack[sp - 1] = -b; break;
      case 0x18: stack[--sp - 1] = a & b; break;
      case 0x19: stack[--sp - 1] = a | b; break;
      case 0x1a: stack[--sp - 1] = a ^ b; break;
      case 0x1b: stack[sp - 1] = ~b; break;
      case 0x1c: stack[--sp - 1] = a << b; break;
      case 0x1d: stack[--sp - 1] = a >> b; break;
      case 0x1e: stack[--sp - 1] = a >>> b; break;
      case 0x20: stack[--sp - 1] = a === b ? 1 : 0; break;
      case 0x21: stack[--sp - 1] = a < b ? 1 : 0; break;
      case 0x22: stack[--sp - 1] = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
      case 0x30: pc += program.readInt16LE(arg); break;
      case 0x31:
      case 0x32:
        sp--;
        if ((op === 0x31) === (b === 0)) pc += program.readInt16LE(arg);
        break;
      case 0x33:
        if (depth === calls.length) return finish(7);
        calls[depth++] = pc;
        pc = program.readUInt16LE(arg);
        break;
      case 0x34:
        if (depth === 0) return finish(8);
        pc = calls[--depth];
        break;
      case 0x40:
      case 0x41:
        if ((b >>> 0) >= memory.length) return finish(6);
        if (op === 0x40) stack[sp - 1] = memory[b];
        else {
          memory[b] = a;
          sp -= 2;
        }
        break;
      case 0x50: {
        const digits = String(b);
        if (written + digits.length > output.length) return finish(11);
        written += output.write(digits, written, 'ascii');
        sp--;
        break;
      }
      case 0x51:
        if (written === output.length) return finish(11);
        output[written++] = b & 255;
        sp--;
        break;
      case 0x52: stack[sp++] = read < input.length ? input[read++] : -1; break;
      case 0x53: return finish(b & 255);
    }
  }
  return finish(10);
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(inputDir).sort()) {
  const program = readFileSync(join(inputDir, id, 'program.bin'));
  const input = readFileSync(join(inputDir, id, 'input.bin'));
  const [stdout, code] = run(program, input);
  const answer = join(outputDir, id);
  mkdirSync(answer, { recursive: true });
  writeFileSync(join(answer, 'stdout.bin'), stdout);
  writeFileSync(join(answer, 'exit.txt'), `${code}\n`);
}
