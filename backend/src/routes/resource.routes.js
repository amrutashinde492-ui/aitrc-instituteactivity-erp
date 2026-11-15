
const express = require('express');
const { z } = require('zod');

const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const validate = require('../middleware/validate');

const Users = require('../controllers/users.controller');
const Resources = require('../controllers/resources.controller');

const Department = require('../models/Department');
const Committee = require('../models/Committee');
const AcademicYear = require('../models/AcademicYear');
const CalendarEvent = require('../models/CalendarEvent');

const V = require('../validators/resource.validators');
const { ROLES } = require('../constants/roles');
const ApiError = require('../utils/ApiError');
const { serializeDocument } = require('../utils/serialize');

const router = express.Router();

/* =========================================================
   AUTHENTICATION
   All routes in this file require a logged-in user.
========================================================= */

router.use(authenticate);

/* =========================================================
   ROLE GROUPS
========================================================= */

const leadership = authorize(
  'DIRECTOR',
  'PRINCIPAL',
  'ADMIN'
);

const departmentManagers = authorize(
  'DIRECTOR',
  'PRINCIPAL',
  'ADMIN',
  'HOD'
);

const calendarManagers = authorize(
  'DIRECTOR',
  'PRINCIPAL',
  'ADMIN',
  'HOD',
  'COMMITTEE_HEAD'
);

const userManagers = authorize(
  ...ROLES.filter((role) => role !== 'FACULTY')
);

/* =========================================================
   USERS
========================================================= */

// Get all users
router.get(
  '/users',
  userManagers,
  Users.list
);

// Create user (Admin and HOD)
router.post(
  '/users',
  authorize('ADMIN', 'HOD'),
  validate(V.userCreate),
  Users.create
);

// Get user by ID
router.get(
  '/users/:id',
  userManagers,
  Users.getById
);

// Update user (Admin only)
router.patch(
  '/users/:id',
  authorize('ADMIN'),
  validate(V.userPatch),
  Users.update
);

// Activate or deactivate user (Admin and HOD)
router.patch(
  '/users/:id/status',
  authorize('ADMIN', 'HOD'),
  validate(
    z.object({
      isActive: z.boolean()
    }).strict()
  ),
  Users.setStatus
);

// Change user role
router.patch(
  '/users/:id/role',
  authorize('ADMIN'),
  validate(
    z.object({
      role: z.enum(ROLES)
    }).strict()
  ),
  Users.changeRole
);

/* =========================================================
   DEPARTMENTS
========================================================= */

// List departments
router.get(
  '/departments',
  Resources.list(Department)
);

// Create department
router.post(
  '/departments',
  leadership,
  validate(V.departmentCreate),
  Resources.create(Department)
);

// Get department by ID
router.get(
  '/departments/:id',
  Resources.getById(Department)
);

// Update department
router.patch(
  '/departments/:id',
  leadership,
  validate(V.departmentPatch),
  Resources.update(Department, [
    'name',
    'code',
    'description',
    'hodId',
    'isActive'
  ])
);

/* =========================================================
   COMMITTEES
========================================================= */

// List committees
router.get(
  '/committees',
  Resources.list(Committee)
);

// Create committee
router.post(
  '/committees',
  leadership,
  validate(V.committeeCreate),
  Resources.create(Committee)
);

// Get committee by ID
router.get(
  '/committees/:id',
  Resources.getById(Committee)
);

// Update committee
router.patch(
  '/committees/:id',
  leadership,
  validate(V.committeePatch),
  Resources.update(Committee, [
    'name',
    'code',
    'description',
    'departmentId',
    'headId',
    'memberIds',
    'isActive'
  ])
);

// Replace committee members
router.put(
  '/committees/:id/members',
  leadership,
  validate(
    z.object({
      memberIds: z
        .array(z.string().regex(/^[a-f\d]{24}$/i))
    }).strict()
  ),
  Resources.replaceCommitteeMembers
);

/* =========================================================
   ACADEMIC YEARS
========================================================= */

// List academic years
router.get(
  '/academic-years',
  Resources.list(AcademicYear)
);

// Create academic year
router.post(
  '/academic-years',
  leadership,
  validate(V.academicYearCreate),
  Resources.create(AcademicYear)
);

// Get academic year by ID
router.get(
  '/academic-years/:id',
  Resources.getById(AcademicYear)
);

// Update academic year
router.patch(
  '/academic-years/:id',
  leadership,
  validate(V.academicYearPatch),
  Resources.update(AcademicYear, [
    'name',
    'startDate',
    'endDate'
  ])
);

// Activate academic year
router.post(
  '/academic-years/:id/activate',
  leadership,
  Resources.activateAcademicYear
);

// Archive academic year
router.post(
  '/academic-years/:id/archive',
  leadership,
  Resources.archiveAcademicYear
);

/* =========================================================
   CALENDAR EVENTS
========================================================= */

// List calendar events
router.get(
  '/calendar/events',
  Resources.list(CalendarEvent)
);

// Create calendar event
router.post(
  '/calendar/events',
  calendarManagers,
  validate(V.eventCreate),
  Resources.create(
    CalendarEvent,
    (req) => ({
      createdBy: req.user._id
    })
  )
);

// Get calendar event by ID
router.get(
  '/calendar/events/:id',
  Resources.getById
);

// Update calendar event
router.patch(
  '/calendar/events/:id',
  calendarManagers,
  validate(V.eventPatch),
  Resources.update(CalendarEvent, [
    'title',
    'description',
    'startAt',
    'endAt',
    'academicYearId',
    'departmentIds',
    'committeeIds',
    'visibility',
    'activityId',
    'isArchived'
  ])
);

// Archive calendar event (soft delete)
router.delete(
  '/calendar/events/:id',
  leadership,
  async (req, res, next) => {
    try {
      const event = await CalendarEvent.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            isArchived: true
          }
        },
        {
          new: true,
          runValidators: true
        }
      );

      if (!event) {
        throw new ApiError(
          404,
          'NOT_FOUND',
          'Calendar event not found'
        );
      }

      return res.status(200).json({
        success: true,
        data: serializeDocument(event)
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* =========================================================
   EXPORT ROUTER
========================================================= */

module.exports = router;
