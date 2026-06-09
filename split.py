import sys

with open('wasm_engine/src/lib.rs', 'r') as f:
    content = f.read()

# Instead of automated, let's just use string search
start_idx = content.find('#[wasm_bindgen]\npub fn pollard_p1_bytes')
if start_idx == -1:
    print("Could not find start")
    sys.exit(1)

end_idx = content.find('// This is a dummy function just to ensure the file parses successfully.')
if end_idx == -1:
    print("Could not find end")
    sys.exit(1)

ecm_content = content[start_idx:end_idx]

# We need to prepend some imports and types to ecm_content
prefix = """use wasm_bindgen::prelude::*;
use crate::{Int, DoubleInt, MontgomerySpace, Xoroshiro128PlusPlus, gcd, int_from_le_slice};

"""

with open('wasm_engine/src/ecm.rs', 'w') as f:
    f.write(prefix + ecm_content)

# Now modify lib.rs
lib_content = content[:start_idx] + content[end_idx:]

# Add mod ecm; and make sure types are public if used across mods
# Actually, it's easier if we just write the whole thing.

# We need to make Int, DoubleInt, MontgomerySpace, Xoroshiro128PlusPlus, gcd, int_from_le_slice pub(crate) or pub
lib_content = lib_content.replace('type Int = U256;', 'pub(crate) type Int = U256;')
lib_content = lib_content.replace('type DoubleInt = U512;', 'pub(crate) type DoubleInt = U512;')
lib_content = lib_content.replace('struct Xoroshiro128PlusPlus', 'pub(crate) struct Xoroshiro128PlusPlus')
lib_content = lib_content.replace('impl Xoroshiro128PlusPlus', 'pub(crate) impl Xoroshiro128PlusPlus')
lib_content = lib_content.replace('fn new() -> Self', 'pub(crate) fn new() -> Self')
lib_content = lib_content.replace('fn next(&mut self) -> u64', 'pub(crate) fn next(&mut self) -> u64')

lib_content = lib_content.replace('struct MontgomerySpace', 'pub(crate) struct MontgomerySpace')
lib_content = lib_content.replace('impl MontgomerySpace', 'pub(crate) impl MontgomerySpace')

lib_content = lib_content.replace('fn gcd(', 'pub(crate) fn gcd(')
lib_content = lib_content.replace('fn int_from_le_slice(', 'pub(crate) fn int_from_le_slice(')

# Add mod ecm;
insert_idx = lib_content.find('// Fixed-size BigInt using ruint.')
lib_content = lib_content[:insert_idx] + 'pub mod ecm;\n\n' + lib_content[insert_idx:]

with open('wasm_engine/src/lib.rs', 'w') as f:
    f.write(lib_content)

print("Done")
