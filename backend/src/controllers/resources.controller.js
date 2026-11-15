
const mongoose = require('mongoose');

const ApiError = require('../utils/ApiError');
const { serializeDocument } = require('../utils/serialize');

const isValidId = (id) => mongoose.isValidObjectId(id);

const sendSuccess = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    data
  });
};

const getRequestData = (req) => {
  if (!req.body || typeof req.body !== 'object') {
    return {};
  }

  return req.body;
};

const getResourceId = (req) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    throw new ApiError(400, 'INVALID_ID', 'Invalid resource ID');
  }

  return id;
};

const normalizeDocument = (document) => {
  if (!document) return null;
  return serializeDocument(document);
};

/**
 * GET /resource
 * List documents with pagination.
 *
 * Supports:
 * ?page=1&limit=20
 * ?isActive=true
 *
 * Archived calendar events are excluded by default.
 */
const list = (Model) => async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20)
    );

    const filter = {};

if (Model.modelName === 'Department' && req.user?.role === 'HOD') {
  filter._id = { $in: req.user.departmentIds || [] };
}

    if (Model.schema.path('isArchived')) {
      filter.isArchived = false;
    }

    if (
      typeof req.query.isActive === 'string' &&
      Model.schema.path('isActive')
    ) {
      if (req.query.isActive === 'true') {
        filter.isActive = true;
      } else if (req.query.isActive === 'false') {
        filter.isActive = false;
      } else {
        throw new ApiError(
          400,
          'INVALID_QUERY',
          'isActive must be true or false'
        );
      }
    }

    const skip = (page - 1) * limit;

    const [documents, total] = await Promise.all([
      Model.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Model.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      data: documents.map(normalizeDocument),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /resource
 * Create a document.
 *
 * extraFields can add server-controlled fields such as createdBy.
 */
const create = (Model, extraFields = {}) => async (req, res, next) => {
  try {
    const body = getRequestData(req);

    const document = await Model.create({
      ...body,
      ...(
        typeof extraFields === 'function'
          ? extraFields(req)
          : extraFields
      )
    });

    return sendSuccess(
      res,
      normalizeDocument(document),
      201
    );
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /resource/:id
 * Get one document by ID.
 */
const getById = (Model) => async (req, res, next) => {
  try {
    const id = getResourceId(req);

    const document = await Model.findById(id).lean();

    if (
      !document ||
      (document.isArchived === true)
    ) {
      throw new ApiError(
        404,
        'NOT_FOUND',
        'Resource not found'
      );
    }

    return sendSuccess(res, normalizeDocument(document));
  } catch (error) {
    return next(error);
  }
};

/**
 * PATCH /resource/:id
 * Update only fields allowed by the route.
 *
 * Never pass the entire request body directly to MongoDB.
 */
const update = (Model, allowedFields = []) => async (req, res, next) => {
  try {
    const id = getResourceId(req);
    const body = getRequestData(req);

    if (!Array.isArray(allowedFields) || allowedFields.length === 0) {
      throw new ApiError(
        500,
        'INVALID_CONFIGURATION',
        'Update fields are not configured'
      );
    }

    const allowedSet = new Set(allowedFields);
    const suppliedFields = Object.keys(body);

    const forbiddenFields = suppliedFields.filter(
      (field) => !allowedSet.has(field)
    );

    if (forbiddenFields.length > 0) {
      throw new ApiError(
        400,
        'INVALID_FIELDS',
        `Unsupported update fields: ${forbiddenFields.join(', ')}`
      );
    }

    if (suppliedFields.length === 0) {
      throw new ApiError(
        400,
        'EMPTY_UPDATE',
        'Provide at least one field to update'
      );
    }

    const updates = {};

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updates[field] = body[field];
      }
    }

    const document = await Model.findOneAndUpdate(
      {
        _id: id,
        ...(Model.schema.path('isArchived')
          ? { isArchived: { $ne: true } }
          : {})
      },
      {
        $set: updates
      },
      {
        new: true,
        runValidators: true,
        context: 'query',
        strict: 'throw'
      }
    );

    if (!document) {
      throw new ApiError(
        404,
        'NOT_FOUND',
        'Resource not found'
      );
    }

    return sendSuccess(
      res,
      normalizeDocument(document)
    );
  } catch (error) {
    return next(error);
  }
};

/**
 * PUT /committees/:id/members
 * Replace a committee's member list.
 */
const replaceCommitteeMembers = async (req, res, next) => {
  try {
    const id = getResourceId(req);
    const { memberIds } = getRequestData(req);

    if (!Array.isArray(memberIds)) {
      throw new ApiError(
        400,
        'INVALID_MEMBERS',
        'memberIds must be an array'
      );
    }

    if (!memberIds.every(isValidId)) {
      throw new ApiError(
        400,
        'INVALID_MEMBER_ID',
        'Every member ID must be a valid MongoDB ObjectId'
      );
    }

    const uniqueIds = [...new Set(memberIds.map(String))];

    const Committee = require('../models/Committee');
    const User = require('../models/User');

    const users = await User.find({
      _id: { $in: uniqueIds }
    }).select('_id role isActive').lean();

    if (users.length !== uniqueIds.length) {
      throw new ApiError(
        400,
        'INVALID_MEMBERS',
        'One or more committee members do not exist'
      );
    }

    if (users.some((user) => user.isActive === false)) {
      throw new ApiError(
        400,
        'INACTIVE_MEMBER',
        'Inactive users cannot be assigned to a committee'
      );
    }

    const committee = await Committee.findByIdAndUpdate(
      id,
      {
        $set: {
          memberIds: uniqueIds
        }
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!committee) {
      throw new ApiError(
        404,
        'NOT_FOUND',
        'Committee not found'
      );
    }

    return sendSuccess(
      res,
      normalizeDocument(committee)
    );
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /academic-years/:id/activate
 * Activate one academic year and deactivate others.
 *
 * Uses a transaction to avoid partial updates.
 */
const activateAcademicYear = async (req, res, next) => {
  const AcademicYear = require('../models/AcademicYear');
  const session = await mongoose.startSession();

  try {
    const id = getResourceId(req);
    let activatedYear = null;

    await session.withTransaction(async () => {
      const target = await AcademicYear.findById(id).session(session);

      if (!target) {
        throw new ApiError(
          404,
          'NOT_FOUND',
          'Academic year not found'
        );
      }

      if (
        target.startDate &&
        target.endDate &&
        new Date(target.startDate) > new Date(target.endDate)
      ) {
        throw new ApiError(
          400,
          'INVALID_ACADEMIC_YEAR',
          'Academic year start date must be before its end date'
        );
      }

      // Adjust these field names if your model uses a different
      // active/archive representation.
      await AcademicYear.updateMany(
        { _id: { $ne: id } },
        { $set: { isActive: false } },
        { session }
      );

      target.isActive = true;

      if (target.isArchived === true) {
        throw new ApiError(
          400,
          'ARCHIVED_ACADEMIC_YEAR',
          'An archived academic year cannot be activated'
        );
      }

      await target.save({ session });
      activatedYear = target;
    });

    return sendSuccess(
      res,
      normalizeDocument(activatedYear)
    );
  } catch (error) {
    return next(error);
  } finally {
    await session.endSession();
  }
};

/**
 * POST /academic-years/:id/archive
 */
const archiveAcademicYear = async (req, res, next) => {
  try {
    const id = getResourceId(req);
    const AcademicYear = require('../models/AcademicYear');

    const year = await AcademicYear.findById(id);

    if (!year) {
      throw new ApiError(
        404,
        'NOT_FOUND',
        'Academic year not found'
      );
    }

    if (year.isActive === true) {
      throw new ApiError(
        400,
        'ACTIVE_ACADEMIC_YEAR',
        'Deactivate the academic year before archiving it'
      );
    }

    if (year.isArchived === true) {
      return sendSuccess(res, normalizeDocument(year));
    }

    if (AcademicYear.schema.path('isArchived')) {
      year.isArchived = true;
    } else if (AcademicYear.schema.path('isActive')) {
      // Fallback for schemas that use isActive instead of isArchived.
      year.isActive = false;
    } else {
      throw new ApiError(
        500,
        'INVALID_CONFIGURATION',
        'AcademicYear model needs an archive or active field'
      );
    }

    await year.save();

    return sendSuccess(res, normalizeDocument(year));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  list,
  create,
  getById,
  update,
  replaceCommitteeMembers,
  activateAcademicYear,
  archiveAcademicYear
};
