with open('js/core/siqs_coordinator.js', 'r') as f:
    content = f.read()

# Modify handleRelation to handle largePrime

import re

search_str = """    handleRelation(data) {
        if (!this.active || this.engine.activeTarget !== data.target) return;

        // Use BigInt representation to form a stable string-free signature where possible, or an optimized hash
        let sig = `${data.rel.x}-${data.rel.A}-${data.rel.B}`;"""

replace_str = """    handleRelation(data) {
        if (!this.active || this.engine.activeTarget !== data.target) return;

        if (!this.partialRelations) this.partialRelations = new Map();

        // Check if it's a partial relation
        if (data.rel.largePrime) {
            let lp = data.rel.largePrime;
            if (this.partialRelations.has(lp)) {
                let r1 = this.partialRelations.get(lp);
                let r2 = data.rel;

                // Combine r1 and r2 into a full relation
                let kNBig = BigInt(this.engine.activeTarget) * this.k;
                let L = BigInt(lp);

                // V1 = A1 * x1^2 + 2 * B1 * x1 + C1? No, we need A1*x1 + B1
                // Actually the relation is: (A*x + B)^2 = A * (A*x^2 + 2Bx + C) mod kN
                // For combining partial relations (u1^2 = v1 * L mod N) and (u2^2 = v2 * L mod N)
                // (u1 * u2 * L^-1)^2 = v1 * v2 mod N

                let u1 = (BigInt(r1.A) * BigInt(r1.x) + BigInt(r1.B)) % kNBig;
                if (u1 < 0n) u1 += kNBig;
                let u2 = (BigInt(r2.A) * BigInt(r2.x) + BigInt(r2.B)) % kNBig;
                if (u2 < 0n) u2 += kNBig;

                let invLRes = extGCDInverse(L, kNBig);
                if (invLRes.success) {
                    let u_new = (u1 * u2) % kNBig;
                    u_new = (u_new * invLRes.value) % kNBig;

                    let new_factors = [...r1.factors, ...r2.factors];
                    let new_sign = r1.sign * r2.sign;

                    // Add this synthesized relation
                    let combinedRel = {
                        x: u_new.toString(),
                        A: "1", // Since u_new is already fully evaluated, we can just say x = u_new, A = 1, B = 0
                        B: "0",
                        sign: new_sign,
                        factors: new_factors
                    };

                    // Remove the partial
                    this.partialRelations.delete(lp);

                    // We recursively process this synthesized relation
                    this.handleRelation({ target: data.target, rel: combinedRel, polyCount: data.polyCount });
                }
            } else {
                this.partialRelations.set(lp, data.rel);
            }
            return;
        }

        // Use BigInt representation to form a stable string-free signature where possible, or an optimized hash
        let sig = `${data.rel.x}-${data.rel.A}-${data.rel.B}`;"""

content = content.replace(search_str, replace_str)

with open('js/core/siqs_coordinator.js', 'w') as f:
    f.write(content)
