// index.js (Previously server.js) - Full CRUD API (Fixed BigInt, Refined)

require('dotenv').config(); // Load .env variables first
const express = require('express');
const mariadb = require('mariadb');
const path = require('path'); // Needed for serving static files correctly

const app = express();
const port = process.env.PORT || 3000;

// --- Database Connection Pool ---
let pool;
try {
    pool = mariadb.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionLimit: 10, // Sensible default
        charset: 'utf8mb4', // Support full UTF-8
        // *** IMPORTANT: Handle BigInts from DB by returning them as strings ***
        supportBigNumbers: true,
        bigNumberStrings: true
    });
    console.log("Database pool created successfully!");
} catch (error) {
    console.error("!!! FATAL ERROR creating database pool:", error);
    process.exit(1); // Exit if DB connection setup fails
}


// --- Middleware ---
// Serve static files (HTML, CSS, JS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Parse JSON request bodies
app.use(express.json());

// --- API Routes ---

// ========== READ ALL (GET /api/parts) ==========
app.get('/api/parts', async (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/parts - Requesting all parts`);
    let conn;
    try {
        conn = await pool.getConnection();
        // Select all columns, order by ID descending (latest first)
        const query = "SELECT * FROM parts ORDER BY part_id DESC;";
        const rows = await conn.query(query);
        // BigInts should be strings due to pool config 'bigNumberStrings: true'
        res.json(rows);
    } catch (err) {
        console.error("Error [GET /api/parts]:", err);
        res.status(500).json({ message: 'Server error while fetching parts.' });
    } finally {
        if (conn) conn.release(); // Always release connection
    }
});

// ========== READ ONE (GET /api/parts/:id) ==========
app.get('/api/parts/:id', async (req, res) => {
    const partId = req.params.id; // ID from URL (string)
    // Basic validation: check if ID looks like a number (optional but good)
    if (!/^\d+$/.test(partId)) {
       return res.status(400).json({ message: 'Invalid part ID format.' });
    }
    console.log(`[${new Date().toISOString()}] GET /api/parts/${partId} - Requesting part ID: ${partId}`);
    let conn;
    try {
        conn = await pool.getConnection();
        const query = "SELECT * FROM parts WHERE part_id = ?";
        const rows = await conn.query(query, [partId]); // Use parameterized query

        if (rows.length > 0) {
            // BigInts should be strings due to pool config
            res.json(rows[0]); // Send the found part
        } else {
            res.status(404).json({ message: `Part with ID: ${partId} not found.` });
        }
    } catch (err) {
        console.error(`Error [GET /api/parts/${partId}]:`, err);
        res.status(500).json({ message: 'Server error while fetching specific part.' });
    } finally {
        if (conn) conn.release();
    }
});

// ========== CREATE (POST /api/parts) ==========
app.post('/api/parts', async (req, res) => {
    console.log(`[${new Date().toISOString()}] POST /api/parts - Creating new part`);
    const { name, description, quantity, price, category } = req.body;
    console.log('Received data for creation:', req.body);

    // --- Server-side Validation ---
    if (!name || String(name).trim() === '') {
        return res.status(400).json({ message: 'Part name cannot be empty.' });
    }
    // Convert and validate quantity (default to 0 if blank/null/undefined)
    const numQuantity = (quantity === null || quantity === undefined || String(quantity).trim() === '') ? 0 : parseInt(quantity);
    if (isNaN(numQuantity) || numQuantity < 0) {
        return res.status(400).json({ message: 'Quantity must be a non-negative number.' });
    }
    // Convert and validate price (allow null if blank/null/undefined)
    let numPrice = null;
    if (!(price === null || price === undefined || String(price).trim() === '')) {
        numPrice = parseFloat(price);
        if (isNaN(numPrice) || numPrice < 0) {
             return res.status(400).json({ message: 'Price must be a non-negative number or empty.' });
        }
    }

    let conn;
    try {
        conn = await pool.getConnection();
        const query = "INSERT INTO parts (name, description, quantity, price, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())";
        const params = [
            String(name).trim(),
            description || null, // Use null if description is empty/falsy
            numQuantity,
            numPrice,            // Already handles null
            category || null     // Use null if category is empty/falsy
        ];
        const result = await conn.query(query, params);

        // Check if insert was successful (affectedRows=1 and insertId exists)
        // result.insertId should be a string because of 'bigNumberStrings: true'
        if (result.affectedRows === 1 && result.insertId !== undefined) {
            const insertId = result.insertId; // This should be a string
            console.log("Part created successfully, ID:", insertId);

            // Construct the newly created part object to send back
            // Could also re-query using insertId to get DB-generated timestamps
            const newPart = {
                 part_id: insertId, // ID is likely a string now
                 name: String(name).trim(),
                 description: description || null,
                 quantity: numQuantity,
                 price: numPrice,
                 category: category || null
                 // created_at, updated_at could be added if re-queried
             };
            res.status(201).json(newPart); // Send 201 Created status and the new part data
        } else {
             console.error("Insert failed or insertId not returned, result:", result);
            throw new Error('Failed to create part in database.');
        }
    } catch (err) {
        console.error("Error [POST /api/parts]:", err);
        // Check for specific DB errors like duplicate entry if needed
        // if (err.code === 'ER_DUP_ENTRY') { return res.status(409).json({ message: 'Part name already exists.' }); }
        res.status(500).json({ message: err.message || 'Server error while creating part.' });
    } finally {
        if (conn) conn.release();
    }
});

// ========== UPDATE (PUT /api/parts/:id) ==========
app.put('/api/parts/:id', async (req, res) => {
    const partId = req.params.id; // ID from URL (string)
    if (!/^\d+$/.test(partId)) {
       return res.status(400).json({ message: 'Invalid part ID format.' });
    }
    console.log(`[${new Date().toISOString()}] PUT /api/parts/${partId} - Updating part ID: ${partId}`);
    const { name, description, quantity, price, category } = req.body;
    console.log('Received data for update:', req.body);

    // --- Server-side Validation (similar to POST) ---
     if (!name || String(name).trim() === '') { return res.status(400).json({ message: 'Part name cannot be empty.' }); }
     const numQuantity = (quantity === null || quantity === undefined || String(quantity).trim() === '') ? 0 : parseInt(quantity);
     if (isNaN(numQuantity) || numQuantity < 0) { return res.status(400).json({ message: 'Quantity must be a non-negative number.' }); }
    let numPrice = null;
     if (!(price === null || price === undefined || String(price).trim() === '')) {
         numPrice = parseFloat(price);
         if (isNaN(numPrice) || numPrice < 0) { return res.status(400).json({ message: 'Price must be a non-negative number or empty.' }); }
     }

    let conn;
    try {
        conn = await pool.getConnection();
        // Update relevant fields and the updated_at timestamp
        const query = "UPDATE parts SET name = ?, description = ?, quantity = ?, price = ?, category = ?, updated_at = NOW() WHERE part_id = ?";
        const params = [
            String(name).trim(),
            description || null,
            numQuantity,
            numPrice,
            category || null,
            partId // ID for the WHERE clause
        ];
        const result = await conn.query(query, params);

        // Check the result
        if (result.affectedRows === 1) {
            console.log("Part updated successfully, ID:", partId);
            // Construct the updated part object to send back
            // Could re-query if you need the exact 'updated_at' timestamp from DB
            const updatedPart = {
                 part_id: partId, // Use the ID from param (it's a string)
                 name: String(name).trim(),
                 description: description || null,
                 quantity: numQuantity,
                 price: numPrice,
                 category: category || null
             };
            res.json(updatedPart); // Send 200 OK with updated data
        } else if (result.affectedRows === 0) {
            // No rows updated - check if the ID exists
            const [checkExist] = await conn.query("SELECT COUNT(*) as count FROM parts WHERE part_id = ?", [partId]);
             if (checkExist.count === 0) {
                 // ID not found
                 res.status(404).json({ message: `Part with ID: ${partId} not found for update.` });
             } else {
                 // ID exists, but data was identical (no changes made)
                 console.log("Part data identical, no changes made for ID:", partId);
                 // Return the existing data as confirmation
                  const existingPart = {
                    part_id: partId, name: String(name).trim(), description: description || null,
                    quantity: numQuantity, price: numPrice, category: category || null
                  };
                 res.json(existingPart);
             }
        } else {
             // Should not happen with WHERE part_id = ?
             throw new Error(`Unexpected number of rows affected during update: ${result.affectedRows}`);
        }
    } catch (err) {
        console.error(`Error [PUT /api/parts/${partId}]:`, err);
        res.status(500).json({ message: err.message || 'Server error while updating part.' });
    } finally {
        if (conn) conn.release();
    }
});

// ========== DELETE (DELETE /api/parts/:id) ==========
app.delete('/api/parts/:id', async (req, res) => {
    const partId = req.params.id; // ID from URL (string)
    if (!/^\d+$/.test(partId)) {
       return res.status(400).json({ message: 'Invalid part ID format.' });
    }
    console.log(`[${new Date().toISOString()}] DELETE /api/parts/${partId} - Deleting part ID: ${partId}`);

    let conn;
    try {
        conn = await pool.getConnection();
        const query = "DELETE FROM parts WHERE part_id = ?";
        const result = await conn.query(query, [partId]); // Use parameterized query

        if (result.affectedRows === 1) {
            console.log("Part deleted successfully, ID:", partId);
            // Send success message or status 204
            res.json({ message: `Part ID: ${partId} deleted successfully.` });
            // Alt: res.status(204).send(); // No content response
        } else {
            // No rows deleted, likely means ID was not found
            res.status(404).json({ message: `Part with ID: ${partId} not found for deletion.` });
        }
    } catch (err) {
        console.error(`Error [DELETE /api/parts/${partId}]:`, err);
        res.status(500).json({ message: err.message || 'Server error while deleting part.' });
    } finally {
        if (conn) conn.release();
    }
});

// --- Catch-all for unhandled API routes (optional) ---
app.use('/api/*', (req, res) => {
    res.status(404).json({ message: 'API endpoint not found.' });
});

// --- Fallback for Single Page Application (if needed) ---
// If you are using client-side routing, uncomment this to serve index.html for non-API routes
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });

// --- Server Listener ---
// Test DB connection before starting the server
pool.getConnection()
    .then(conn => {
        console.log("Database connection test successful!");
        conn.release();
        // Start the Express server
        app.listen(port, () => {
            console.log(`Server listening on http://localhost:${port}`);
            console.log(`Frontend should be accessible at http://localhost:${port}/`);
            console.log('Press CTRL+C to stop the server.');
        });
    })
    .catch(err => {
        console.error("!!! Database connection test failed:", err);
        console.error("!!! Server cannot start without a database connection.");
        console.error("!!! Please check .env settings and database status.");
        process.exit(1); // Exit if DB isn't available on startup
    });