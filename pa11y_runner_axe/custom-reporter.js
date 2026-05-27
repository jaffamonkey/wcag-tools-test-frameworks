// const fs = require('fs').promises;
// const path = require('path');

// module.exports = (options) => {
//     const outputDir = options.dir || 'reports';

//     return {
//         async results(results) {
//             await fs.mkdir(outputDir, { recursive: true });

//             // 1. Combine hostname and pathname (e.g., automationexercise.com/brand_products/H&M)
//             const url = new URL(results.pageUrl);
//             const fullPath = url.hostname + url.pathname;

//             // 2. Replace any non-alphanumeric character with an underscore
//             // This handles dots (.), slashes (/), and symbols (&)
//             const sanitizedBase = fullPath.replace(/[^a-z0-9]/gi, '_');

//             // 3. Remove trailing underscores if the URL ended in a slash
//             const fileName = `${sanitizedBase.replace(/_$/, '')}.json`;

//             const filePath = path.join(outputDir, fileName);

//             await fs.writeFile(filePath, JSON.stringify(results, null, 2), 'utf8');
//             console.log(`Report saved: ${filePath}`);
//         }
//     };
// };


const fs = require('fs').promises;
const path = require('path');

module.exports = (options) => {
    const outputDir = options.dir || 'reports';

    return {
        async results(results) {
            await fs.mkdir(outputDir, { recursive: true });

            const url = new URL(results.pageUrl);

            // Combine hostname, pathname, and query string
            // Example:
            // https://www.futureme.org/blog/category?name=goal-setting
            // becomes:
            // www.futureme.org/blog/category/name/goal-setting
            const queryPart = url.search
                ? url.search.replace(/^\?/, '').replace(/=/g, '/')
                : '';

            const fullPath = [
                url.hostname,
                url.pathname,
                queryPart
            ]
                .filter(Boolean)
                .join('/');

            // Replace any non-alphanumeric character with an underscore
            const sanitizedBase = fullPath.replace(/[^a-z0-9]/gi, '_');

            // Remove leading/trailing underscores
            const fileName = `${sanitizedBase.replace(/^_+|_+$/g, '')}.json`;

            const filePath = path.join(outputDir, fileName);

            await fs.writeFile(filePath, JSON.stringify(results, null, 2), 'utf8');
            console.log(`Report saved: ${filePath}`);
        }
    };
};