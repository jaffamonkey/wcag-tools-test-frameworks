const fs = require('fs').promises;
const path = require('path');

module.exports = (options) => {
    const outputDir = options.dir || 'reports';

    return {
        async results(results) {
            await fs.mkdir(outputDir, { recursive: true });

            // 1. Remove trailing slashes and the protocol/domain
            const urlPath = results.pageUrl.replace(/\/$/, '').split('/');
            
            // 2. Get the last segment of the path
            let fileName = urlPath.pop() || 'home';

            // 3. Clean characters that are illegal in filenames and append .json
            const safeName = `${fileName.replace(/[\/\\?%*:|"<>\.]/g, '-')}.json`;

            const filePath = path.join(outputDir, safeName);

            await fs.writeFile(filePath, JSON.stringify(results, null, 2), 'utf8');
            console.log(`Report saved: ${filePath}`);
        }
    };
};
