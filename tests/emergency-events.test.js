const {
  createEmergency,
  resolveEmergency,
  updateEmergency,
  deleteEmergency,
} = require('../controllers/emergencyControllers');
const EmergencyAlert = require('../models/EmergencyAlert');
const { User, Flat, Block } = require('../models');

jest.mock('../models/EmergencyAlert');
jest.mock('../models', () => ({
  User: { findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
  Flat: { findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
  Block: { findOne: jest.fn(), findByPk: jest.fn() },
  HouseHoldMember: { findAll: jest.fn().mockResolvedValue([]) },
  Society: { findByPk: jest.fn() },
  FlatMembership: { findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../models/GuardShift', () => ({
  findAll: jest.fn().mockResolvedValue([]),
}));
jest.mock('../utils/shiftTiming', () => ({
  getShiftTimings: jest.fn().mockResolvedValue([]),
  isTimeInShift: jest.fn().mockReturnValue(false),
}));
jest.mock('../services/notificationService', () => ({
  createNotification: jest.fn().mockResolvedValue({}),
  sendNotification: jest.fn().mockResolvedValue({}),
}));
jest.mock('../utils/pushNotification', () => ({
  sendPushNotification: jest.fn().mockResolvedValue({}),
}));

describe('Emergency Controller Socket Events', () => {
  let req, res, mockIo, mockRoom;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRoom = {
      emit: jest.fn(),
    };
    mockIo = {
      to: jest.fn().mockReturnValue(mockRoom),
    };
    global.io = mockIo;

    req = {
      app: {
        get: jest.fn((key) => {
          if (key === 'io') return mockIo;
          return null;
        }),
      },
      user: {
        id: 1,
        society_id: 10,
        role: 'RESIDENT',
      },
      params: {},
      body: {},
      query: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    User.findAll.mockResolvedValue([]);
  });

  afterEach(() => {
    delete global.io;
  });

  test('createEmergency emits enriched emergency_alert to society room', async () => {
    req.body = {
      type: 'FIRE',
      message: 'Smoke detected in wing A',
      flat_id: 5,
    };

    const mockEmergency = {
      id: 42,
      society_id: 10,
      flat_id: 5,
      resident_id: 1,
      type: 'FIRE',
      message: 'Smoke detected in wing A',
      status: 'ACTIVE',
      source: 'RESIDENT',
      created_at: new Date('2026-10-28T10:00:00Z'),
      reload: jest.fn().mockResolvedValue(true),
      toJSON: function() { return this; },
      Flat: { id: 5, flat_number: '101', block_name: 'A' },
      Resident: { id: 1, name: 'John Doe', phone: '9999999999' },
    };

    EmergencyAlert.create.mockResolvedValueOnce(mockEmergency);
    Flat.findByPk.mockResolvedValueOnce({ id: 5, flat_number: '101', society_id: 10 });

    await createEmergency(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockIo.to).toHaveBeenCalledWith('society_10');
    expect(mockRoom.emit).toHaveBeenCalledWith(
      'emergency_alert',
      expect.objectContaining({
        id: 42,
        society_id: 10,
        status: 'ACTIVE',
        type: 'FIRE',
        alert_type: 'FIRE',
        message: 'Smoke detected in wing A',
      })
    );
  });

  test('resolveEmergency emits emergency_resolved with normalized ID and society ID', async () => {
    req.params.id = 42;
    const mockEmergency = {
      id: 42,
      society_id: 10,
      status: 'ACTIVE',
      resident_id: 1,
      type: 'FIRE',
      save: jest.fn().mockResolvedValue(true),
    };

    EmergencyAlert.findByPk.mockResolvedValueOnce(mockEmergency);

    await resolveEmergency(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Emergency resolved successfully',
      })
    );
    expect(mockIo.to).toHaveBeenCalledWith('society_10');
    expect(mockRoom.emit).toHaveBeenCalledWith(
      'emergency_resolved',
      expect.objectContaining({
        id: 42,
        alertId: '42',
        society_id: 10,
        status: 'RESOLVED',
      })
    );
  });

  test('updateEmergency emits emergency_resolved when status is updated to RESOLVED', async () => {
    req.params.id = 42;
    req.body = { status: 'RESOLVED' };

    const mockEmergency = {
      id: 42,
      society_id: 10,
      status: 'ACTIVE',
      save: jest.fn().mockResolvedValue(true),
    };

    EmergencyAlert.findByPk.mockResolvedValueOnce(mockEmergency);

    await updateEmergency(req, res);

    expect(mockIo.to).toHaveBeenCalledWith('society_10');
    expect(mockRoom.emit).toHaveBeenCalledWith(
      'emergency_resolved',
      expect.objectContaining({
        id: 42,
        alertId: '42',
        society_id: 10,
        status: 'RESOLVED',
      })
    );
  });

  test('deleteEmergency emits emergency_resolved to remove alert from clients', async () => {
    req.params.id = 42;

    const mockEmergency = {
      id: 42,
      society_id: 10,
      destroy: jest.fn().mockResolvedValue(true),
    };

    EmergencyAlert.findByPk.mockResolvedValueOnce(mockEmergency);

    await deleteEmergency(req, res);

    expect(mockIo.to).toHaveBeenCalledWith('society_10');
    expect(mockRoom.emit).toHaveBeenCalledWith(
      'emergency_resolved',
      expect.objectContaining({
        id: 42,
        alertId: '42',
        society_id: 10,
        status: 'RESOLVED',
      })
    );
  });
});
