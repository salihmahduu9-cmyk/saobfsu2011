// api/obfuscate.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static front-end files if present in the root
app.use(express.static(path.join(__dirname, '../')));

// Main API Route for Obfuscation
app.post('/obfuscate', (req, res) => {
    const code = req.body.code;
    if (!code) {
        return res.status(400).json({ error: 'No code provided' });
    }

    const rootDir = path.join(__dirname, '../');
    const tempInputPath = path.join(rootDir, `temp_input_${Date.now()}.lua`);
    const tempOutputPath = tempInputPath.replace('.lua', '_obfuscated.lua');

    // Write the received code into a temporary file
    fs.writeFile(tempInputPath, code, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to write temporary file' });
        }

        const herculesPath = path.join(rootDir, 'hercules.lua');
        
        // Execute the obfuscator using the system-installed lua
        // Since we are inside the docker container, we pass the absolute paths
        exec(`lua "${herculesPath}" "${tempInputPath}" --overwrite`, { cwd: rootDir }, (execErr, stdout, stderr) => {
            // Clean up the input file
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);

            if (execErr) {
                if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
                return res.status(500).json({ 
                    error: 'Obfuscation failed', 
                    details: stderr || execErr.message,
                    stdout: stdout
                });
            }

            // Read the obfuscated output
            fs.readFile(tempInputPath, 'utf8', (readErr, obfuscatedCode) => {
                // If overwrite was used, it replaces the content of tempInputPath or writes to tempOutputPath depending on CLI configuration.
                // Let's check which file actually contains the result.
                let finalPath = tempInputPath;
                if (!fs.existsSync(finalPath) && fs.existsSync(tempOutputPath)) {
                    finalPath = tempOutputPath;
                }

                if (!fs.existsSync(finalPath)) {
                    return res.status(500).json({ error: 'Obfuscated output file not found' });
                }

                const result = fs.readFileSync(finalPath, 'utf8');

                // Clean up output file
                if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);

                // Return the obfuscated result
                res.json({ result: result });
            });
        });
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running perfectly on port ${PORT}`);
});
