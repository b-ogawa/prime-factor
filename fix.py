with open('wasm_engine/src/lib.rs', 'r') as f:
    content = f.read()

content = content.replace('pub(crate) impl Xoroshiro128PlusPlus', 'impl Xoroshiro128PlusPlus')
content = content.replace('pub(crate) impl MontgomerySpace', 'impl MontgomerySpace')

# Add pub(crate) to methods instead
content = content.replace('    fn transform(', '    pub(crate) fn transform(')
content = content.replace('    fn reduce(', '    pub(crate) fn reduce(')
content = content.replace('    fn mul(', '    pub(crate) fn mul(')
content = content.replace('    fn add(', '    pub(crate) fn add(')
content = content.replace('    fn sub(', '    pub(crate) fn sub(')

with open('wasm_engine/src/lib.rs', 'w') as f:
    f.write(content)
