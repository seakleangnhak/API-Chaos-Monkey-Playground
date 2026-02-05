/**
 * REST API Routes
 * 
 * Endpoints for managing proxy configuration and chaos rules.
 * Used by the React UI to configure the proxy behavior.
 */

import { Router, Request, Response } from 'express';
import {
    getConfig,
    updateConfig,
    getRules,
    getRule,
    createRule,
    updateRule,
    deleteRule,
    getLogs,
    clearLogs
} from './state.js';
import { ChaosRule } from './types.js';

export const apiRouter = Router();

// ============================================================================
// Configuration Endpoints
// ============================================================================

/**
 * GET /api/config
 * Returns the current proxy configuration.
 */
apiRouter.get('/config', (_req: Request, res: Response) => {
    res.json({ success: true, data: getConfig() });
});

/**
 * PUT /api/config
 * Updates the proxy configuration.
 */
apiRouter.put('/config', (req: Request, res: Response) => {
    const { targetUrl, enabled } = req.body;
    const updated = updateConfig({ targetUrl, enabled });
    res.json({ success: true, data: updated });
});

// ============================================================================
// Rules Endpoints
// ============================================================================

/**
 * GET /api/rules
 * Returns all chaos rules.
 */
apiRouter.get('/rules', (_req: Request, res: Response) => {
    res.json({ success: true, data: getRules() });
});

/**
 * GET /api/rules/:id
 * Returns a specific chaos rule.
 */
apiRouter.get('/rules/:id', (req: Request, res: Response) => {
    const rule = getRule(req.params.id);
    if (!rule) {
        res.status(404).json({ success: false, error: 'Rule not found' });
        return;
    }
    res.json({ success: true, data: rule });
});

/**
 * POST /api/rules
 * Creates a new chaos rule.
 */
apiRouter.post('/rules', (req: Request, res: Response) => {
    const ruleData = req.body as Partial<ChaosRule>;

    // Validate required fields
    if (!ruleData.name || !ruleData.pathPattern || !ruleData.chaosType) {
        res.status(400).json({
            success: false,
            error: 'Missing required fields: name, pathPattern, chaosType'
        });
        return;
    }

    // Generate ID if not provided
    const rule: ChaosRule = {
        id: ruleData.id || `rule-${Date.now()}`,
        name: ruleData.name,
        enabled: ruleData.enabled ?? true,
        pathPattern: ruleData.pathPattern,
        methods: ruleData.methods || ['*'],
        chaosType: ruleData.chaosType,
        latencyMs: ruleData.latencyMs,
        latencyMinMs: ruleData.latencyMinMs,
        latencyMaxMs: ruleData.latencyMaxMs,
        errorStatusCode: ruleData.errorStatusCode,
        errorMessage: ruleData.errorMessage,
        failRate: ruleData.failRate,
    };

    const created = createRule(rule);
    res.status(201).json({ success: true, data: created });
});

/**
 * PUT /api/rules/:id
 * Updates an existing chaos rule.
 */
apiRouter.put('/rules/:id', (req: Request, res: Response) => {
    const updated = updateRule(req.params.id, req.body);
    if (!updated) {
        res.status(404).json({ success: false, error: 'Rule not found' });
        return;
    }
    res.json({ success: true, data: updated });
});

/**
 * DELETE /api/rules/:id
 * Deletes a chaos rule.
 */
apiRouter.delete('/rules/:id', (req: Request, res: Response) => {
    const deleted = deleteRule(req.params.id);
    if (!deleted) {
        res.status(404).json({ success: false, error: 'Rule not found' });
        return;
    }
    res.json({ success: true });
});

// ============================================================================
// Logs Endpoints
// ============================================================================

/**
 * GET /api/logs
 * Returns request logs, optionally limited.
 */
apiRouter.get('/logs', (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    res.json({ success: true, data: getLogs(limit) });
});

/**
 * DELETE /api/logs
 * Clears all request logs.
 */
apiRouter.delete('/logs', (_req: Request, res: Response) => {
    clearLogs();
    res.json({ success: true });
});
