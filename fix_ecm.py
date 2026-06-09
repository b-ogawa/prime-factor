with open('wasm_engine/src/ecm.rs', 'r') as f:
    content = f.read()
content = content.replace('fn ext_gcd_inverse_internal(', 'pub(crate) fn ext_gcd_inverse_internal(')
with open('wasm_engine/src/ecm.rs', 'w') as f:
    f.write(content)
