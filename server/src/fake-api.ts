/**
 * Fake Target API
 * 
 * Built-in fake upstream API for offline demo mode.
 * Select via targetUrl = "internal://fake"
 * 
 * Endpoints:
 * - GET /fake/users - 25 deterministic users
 * - GET /fake/orders - Orders with ?count and ?slow params
 * - POST /fake/login - Mock authentication
 */

import { Router, Request, Response } from 'express';

export const fakeRouter = Router();

// ============================================================================
// Deterministic Data Generation
// ============================================================================

/**
 * Simple deterministic "random" based on seed.
 * Uses a Linear Congruential Generator for reproducibility.
 */
function seededRandom(seed: number): number {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
}

/**
 * Generate deterministic users (always the same across runs).
 */
function generateUsers(): Array<{
    id: number;
    name: string;
    email: string;
    username: string;
    role: string;
    createdAt: string;
}> {
    const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry',
        'Ivy', 'Jack', 'Karen', 'Leo', 'Mia', 'Noah', 'Olivia', 'Paul',
        'Quinn', 'Rose', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier', 'Yara'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
        'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
        'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
        'Lee', 'Perez', 'Thompson', 'White', 'Harris'];
    const roles = ['admin', 'user', 'moderator', 'editor', 'viewer'];

    return Array.from({ length: 25 }, (_, i) => {
        const id = i + 1;
        const firstName = firstNames[i];
        const lastName = lastNames[i];
        const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
        const role = roles[i % roles.length];
        // Deterministic date based on id
        const createdAt = new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString();

        return {
            id,
            name: `${firstName} ${lastName}`,
            email: `${username}@example.com`,
            username,
            role,
            createdAt,
        };
    });
}

/**
 * Generate deterministic orders.
 */
function generateOrders(count: number): Array<{
    id: string;
    userId: number;
    total: number;
    status: string;
    items: Array<{ name: string; price: number; quantity: number }>;
    createdAt: string;
}> {
    const statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    const products = [
        { name: 'Widget Pro', basePrice: 29.99 },
        { name: 'Gadget Plus', basePrice: 49.99 },
        { name: 'Super Device', basePrice: 99.99 },
        { name: 'Mega Tool', basePrice: 19.99 },
        { name: 'Ultra Pack', basePrice: 149.99 },
    ];

    return Array.from({ length: count }, (_, i) => {
        const id = `ORD-${String(1000 + i).padStart(6, '0')}`;
        const userId = (i % 25) + 1;
        const status = statuses[i % statuses.length];

        // Deterministic items based on order index
        const numItems = (i % 3) + 1;
        const items = Array.from({ length: numItems }, (_, j) => {
            const product = products[(i + j) % products.length];
            const quantity = ((i + j) % 5) + 1;
            return {
                name: product.name,
                price: product.basePrice,
                quantity,
            };
        });

        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const createdAt = new Date(Date.UTC(2024, 0, 15 + i)).toISOString();

        return { id, userId, total: Math.round(total * 100) / 100, status, items, createdAt };
    });
}

// ============================================================================
// Helper for delays
// ============================================================================

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * GET /fake/users - Returns 25 deterministic users
 */
fakeRouter.get('/users', (_req: Request, res: Response) => {
    const users = generateUsers();
    res.json(users);
});

/**
 * GET /fake/orders - Returns orders with optional params
 * ?count=N (default 10, max 50)
 * ?slow=1 (adds 300-900ms delay)
 */
fakeRouter.get('/orders', async (req: Request, res: Response) => {
    // Parse count with validation
    let count = parseInt(req.query.count as string, 10);
    if (isNaN(count) || count < 1) count = 10;
    if (count > 50) count = 50;

    // Add delay if slow=1
    if (req.query.slow === '1') {
        // Deterministic "random" delay based on count
        const delayMs = 300 + (count * 12) % 600;
        await delay(delayMs);
    }

    const orders = generateOrders(count);
    res.json(orders);
});

/**
 * POST /fake/login - Mock authentication
 * Valid credentials: admin/admin, demo/demo
 */
fakeRouter.post('/login', async (req: Request, res: Response) => {
    // Small delay to feel realistic
    await delay(150);

    const { username, password } = req.body || {};

    const validCredentials: Record<string, string> = {
        'admin': 'admin',
        'demo': 'demo',
    };

    if (validCredentials[username] === password) {
        const users = generateUsers();
        const user = users.find(u => u.username === username) || users[0];

        res.json({
            token: `fake-jwt-${username}-${Date.now().toString(36)}`,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        });
    } else {
        res.status(401).json({
            error: 'invalid_credentials',
            message: 'Invalid username or password',
        });
    }
});

/**
 * GET /fake/posts/:id - Single post (for testing path params)
 */
fakeRouter.get('/posts/:id', (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
        res.status(404).json({ error: 'not_found', message: 'Post not found' });
        return;
    }

    res.json({
        id,
        userId: (id % 25) + 1,
        title: `Post Title ${id}`,
        body: `This is the body of post ${id}. It contains some sample content for testing.`,
        createdAt: new Date(Date.UTC(2024, 0, id)).toISOString(),
    });
});

/**
 * GET /fake/posts - List of posts
 */
fakeRouter.get('/posts', (req: Request, res: Response) => {
    let limit = parseInt(req.query.limit as string, 10);
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 100) limit = 100;

    const posts = Array.from({ length: limit }, (_, i) => ({
        id: i + 1,
        userId: (i % 25) + 1,
        title: `Post Title ${i + 1}`,
        body: `This is the body of post ${i + 1}. Sample content for testing.`,
        createdAt: new Date(Date.UTC(2024, 0, i + 1)).toISOString(),
    }));

    res.json(posts);
});

/**
 * Catch-all for unmatched fake routes
 */
fakeRouter.all('*', (req: Request, res: Response) => {
    res.status(404).json({
        error: 'not_found',
        message: `Fake API endpoint not found: ${req.method} ${req.path}`,
        availableEndpoints: [
            'GET /fake/users',
            'GET /fake/orders?count=N&slow=1',
            'POST /fake/login',
            'GET /fake/posts',
            'GET /fake/posts/:id',
        ],
    });
});
