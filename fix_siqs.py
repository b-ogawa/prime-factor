with open('wasm_engine/src/siqs.rs', 'r') as f:
    content = f.read()

content = content.replace(
    'let mut threshold = ((log2_a_actual + 2 * log2_m_approx) * 8) as i32 - buffer as i32;',
    'let mut threshold = ((log2_a_actual as i32 + 2 * log2_m_approx as i32) * 8) - buffer as i32;'
)

with open('wasm_engine/src/siqs.rs', 'w') as f:
    f.write(content)
