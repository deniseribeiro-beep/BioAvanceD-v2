from pathlib import Path


def patch(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        if new in text:
            return
        raise SystemExit(f'{label} not found')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


patch(
    'api/backend/src/services/NotificationService.js',
    """  constructor() {
    this.resendClient = null;
""",
    """  constructor({ connectDatabase = connectDB } = {}) {
    this.connectDatabase = connectDatabase;
    this.resendClient = null;
""",
    'NotificationService constructor',
)
patch(
    'api/backend/src/services/NotificationService.js',
    """      const db = await connectDB();
""",
    """      const db = await this.connectDatabase();
""",
    'NotificationService compliance connector',
)

p = Path('api/backend/tests/unit/NotificationService.test.js')
text = p.read_text(encoding='utf-8')
text = text.replace(
    """  let originalNotificationQueue;
""",
    """  let originalNotificationQueue;
  let originalConnectDatabase;
""",
    1,
)
text = text.replace(
    """    originalNotificationQueue = notificationService.notificationQueue;
""",
    """    originalNotificationQueue = notificationService.notificationQueue;
    originalConnectDatabase = notificationService.connectDatabase;
""",
    1,
)
text = text.replace(
    """    notificationService.notificationQueue = originalNotificationQueue;
    notificationService.io = null;
""",
    """    notificationService.notificationQueue = originalNotificationQueue;
    notificationService.connectDatabase = originalConnectDatabase;
    notificationService.io = null;
""",
    1,
)
old = """  describe('persistComplianceLog', () => {
    it('swallows persistence errors and logs them instead of throwing (no MONGO_URI configured in tests)', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      await expect(
        notificationService.persistComplianceLog({ messageId: 'm1', notificationType: 'x' })
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
"""
new = """  describe('persistComplianceLog', () => {
    it('swallows a deterministic Mongo persistence failure and logs it instead of throwing', async () => {
      notificationService.connectDatabase = vi.fn().mockRejectedValue(new Error('mongo unavailable'));
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      await expect(
        notificationService.persistComplianceLog({ messageId: 'm1', notificationType: 'x' })
      ).resolves.toBeUndefined();
      expect(notificationService.connectDatabase).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    });
  });
"""
if old not in text:
    if new not in text:
        raise SystemExit('persistComplianceLog test block not found')
else:
    text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
