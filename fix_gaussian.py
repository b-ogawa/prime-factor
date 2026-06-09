with open('wasm_engine/src/lib.rs', 'r') as f:
    content = f.read()

content = content.replace('1 << (i % 32)', '1u32 << (i % 32)')
content = content.replace('1 << b_idx', '1u32 << b_idx')
content = content.replace('1 << (j % 32)', '1u32 << (j % 32)')

with open('wasm_engine/src/lib.rs', 'w') as f:
    f.write(content)
