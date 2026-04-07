function merge(target, source) {
    for (let key in source) {
        if (typeof source[key] === 'object' && source[key] !== null) {
            merge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
}

function parseQSVulnerable(qs) {
    const obj = {};
    const params = new URLSearchParams(qs);
    for (let [key, val] of params) {
        const partes = key.split(/\]\[|\[|\]/).filter(Boolean);
        let cur = obj;
        partes.forEach((p, i) => {
            if (i === partes.length - 1) cur[p] = val;
            else { cur[p] = cur[p] || {}; cur = cur[p]; }
        });
    }
    const empty = {};
    merge(empty, obj);
    return obj;
}

const qs = window.location.search.slice(1);


if (qs) {
    parseQSVulnerable(qs);
}