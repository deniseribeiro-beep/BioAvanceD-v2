import { vi } from 'vitest';

process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-jwt-secret';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_dummy_key';
process.env.USER_ANON_SALT = process.env.USER_ANON_SALT || 'test-user-anon-salt';

function createMockSession() {
	return {
		run: vi.fn(async () => ({ records: [] })),
		close: vi.fn(async () => undefined)
	};
}

const mockNeo4jDriver = {
	verifyConnectivity: vi.fn(async () => undefined),
	session: vi.fn(() => createMockSession()),
	close: vi.fn(async () => undefined)
};

vi.mock('../src/infrastructure/database/neo4j/connection', () => ({
	connectNeo4j: vi.fn(async () => mockNeo4jDriver),
	getNeo4jDriver: vi.fn(() => mockNeo4jDriver),
	closeNeo4jConnection: vi.fn(async () => undefined),
	getNeo4jConfig: vi.fn(() => ({
		uri: 'bolt://mocked-neo4j:7687',
		username: 'neo4j',
		password: 'mocked-password',
		database: 'neo4j'
	}))
}));

vi.mock('../src/services/session.service', () => ({
	verifySession: vi.fn(async () => ({ valid: true, session: { sessionID: 'test-session', userID: 'test-user' } })),
	updateActivity: vi.fn(async () => ({ sessionID: 'test-session' })),
	revokeSessionById: vi.fn(async () => ({ sessionID: 'test-session', isRevoked: true, revokedAt: new Date() })),
	revokeAllOtherSessions: vi.fn(async () => ({ revokedCount: 0 })),
	listUserSessions: vi.fn(async () => []),
	invalidateSession: vi.fn(async () => true),
	getSessionByRefreshToken: vi.fn(async () => null),
	rotateSessionTokens: vi.fn(async () => true),
	sessions: new Map()
}));
