const { Event, EventMedia, Society, User } = require("../models");
const { Op } = require("sequelize");
const cloudinary = require("../config/cloudinary");

/**
 * Helper to resolve active society_id from authenticated user or Super Admin header
 */
const getTargetSocietyId = (req) => {
  const saHeader = req.headers["x-society-id"];
  if (saHeader && saHeader !== "ALL") {
    return parseInt(saHeader, 10);
  }
  const bodyOrQueryId = req.body?.society_id || req.body?.societyId || req.query?.societyId || req.query?.society_id;
  if (bodyOrQueryId && bodyOrQueryId !== "ALL") {
    return parseInt(bodyOrQueryId, 10);
  }
  return req.user?.society_id || null;
};

/**
 * GET /api/events
 * Resident / Public event listing (active events only)
 */
const getResidentEvents = async (req, res) => {
  try {
    const societyId = getTargetSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required" });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search ? req.query.search.trim() : "";
    const upcoming = req.query.upcoming === "true" || req.query.upcoming === true;
    const { event_date_from, event_date_to } = req.query;

    const whereClause = {
      society_id: societyId,
      is_active: true,
    };

    if (search) {
      whereClause[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { location: { [Op.like]: `%${search}%` } },
      ];
    }

    if (upcoming) {
      whereClause.event_date = { [Op.gte]: new Date().toISOString().split("T")[0] };
    } else if (event_date_from || event_date_to) {
      whereClause.event_date = {};
      if (event_date_from) whereClause.event_date[Op.gte] = event_date_from;
      if (event_date_to) whereClause.event_date[Op.lte] = event_date_to;
    }

    const { count, rows: events } = await Event.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: EventMedia,
          as: "media",
          attributes: ["id", "media_type", "url", "thumb_url", "sort_order"],
        },
      ],
      order: [
        ["event_date", "ASC"],
        ["created_at", "DESC"],
      ],
      limit,
      offset,
      distinct: true,
    });

    const formattedData = events.map((e) => {
      const mediaList = e.media || [];
      const coverObj = mediaList.find((m) => m.media_type === "IMAGE") || mediaList[0];
      const photoCount = mediaList.filter((m) => m.media_type === "IMAGE").length;
      const videoCount = mediaList.filter((m) => m.media_type === "VIDEO").length;

      return {
        id: e.id,
        title: e.title,
        description: e.description,
        event_date: e.event_date,
        event_time: e.event_time,
        location: e.location,
        cover_url: coverObj ? coverObj.url : null,
        photo_count: photoCount,
        video_count: videoCount,
        created_at: e.created_at,
      };
    });

    const totalPages = Math.ceil(count / limit) || 1;

    return res.status(200).json({
      success: true,
      data: formattedData,
      totalAll: count,
      pagination: {
        currentPage: page,
        totalPages,
        total: count,
        limit,
      },
    });
  } catch (error) {
    console.error("getResidentEvents error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch events", error: error.message });
  }
};

/**
 * GET /api/events/admin
 * Admin event listing (active & inactive events)
 */
const getAdminEvents = async (req, res) => {
  try {
    const societyId = getTargetSocietyId(req);
    if (!societyId && req.user.activeRole !== "SUPER_ADMIN") {
      return res.status(400).json({ success: false, message: "Society ID is required" });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search ? req.query.search.trim() : "";

    const whereClause = {};
    if (societyId) {
      whereClause.society_id = societyId;
    }

    if (search) {
      whereClause[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { location: { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows: events } = await Event.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: EventMedia,
          as: "media",
          attributes: ["id", "media_type", "url", "thumb_url", "sort_order"],
        },
        {
          model: Society,
          as: "society",
          attributes: ["id", "name"],
        },
      ],
      order: [["created_at", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    const formattedData = events.map((e) => {
      const mediaList = e.media || [];
      const coverObj = mediaList.find((m) => m.media_type === "IMAGE") || mediaList[0];
      const photoCount = mediaList.filter((m) => m.media_type === "IMAGE").length;
      const videoCount = mediaList.filter((m) => m.media_type === "VIDEO").length;

      return {
        id: e.id,
        society_id: e.society_id,
        society_name: e.society?.name || (e.society_id ? `Society #${e.society_id}` : null),
        society: e.society ? { id: e.society.id, name: e.society.name } : null,
        title: e.title,
        description: e.description,
        event_date: e.event_date,
        event_time: e.event_time,
        location: e.location,
        is_active: e.is_active,
        created_by_user_id: e.created_by_user_id,
        created_by_name: e.created_by_name,
        created_by_role: e.created_by_role,
        cover_url: coverObj ? coverObj.url : null,
        photo_count: photoCount,
        video_count: videoCount,
        created_at: e.created_at,
        updated_at: e.updated_at,
      };
    });

    const totalPages = Math.ceil(count / limit) || 1;

    return res.status(200).json({
      success: true,
      data: formattedData,
      totalAll: count,
      pagination: {
        currentPage: page,
        totalPages,
        total: count,
        limit,
      },
    });
  } catch (error) {
    console.error("getAdminEvents error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch admin events", error: error.message });
  }
};

/**
 * GET /api/events/:id
 * Get single event details with complete media gallery
 */
const getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const societyId = getTargetSocietyId(req);

    const event = await Event.findByPk(id, {
      include: [
        {
          model: EventMedia,
          as: "media",
          order: [["sort_order", "ASC"], ["created_at", "ASC"]],
        },
        {
          model: Society,
          as: "society",
          attributes: ["id", "name"],
        },
      ],
    });

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    // Verify society isolation
    if (societyId && event.society_id !== societyId && req.user.activeRole !== "SUPER_ADMIN") {
      return res.status(403).json({ success: false, message: "Access denied. Event belongs to another society." });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: event.id,
        society_id: event.society_id,
        society_name: event.society?.name || (event.society_id ? `Society #${event.society_id}` : null),
        society: event.society ? { id: event.society.id, name: event.society.name } : null,
        title: event.title,
        description: event.description,
        event_date: event.event_date,
        event_time: event.event_time,
        location: event.location,
        is_active: event.is_active,
        created_by_user_id: event.created_by_user_id,
        created_by_name: event.created_by_name,
        created_by_role: event.created_by_role,
        created_at: event.created_at,
        updated_at: event.updated_at,
        media: (event.media || []).map((m) => ({
          id: m.id,
          media_type: m.media_type,
          url: m.url,
          public_id: m.public_id,
          thumb_url: m.thumb_url,
          sort_order: m.sort_order,
          original_name: m.original_name,
          size_bytes: m.size_bytes,
        })),
      },
    });
  } catch (error) {
    console.error("getEventById error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch event details", error: error.message });
  }
};

/**
 * POST /api/events
 * Create new event with photo & video uploads
 */
const createEvent = async (req, res) => {
  try {
    const societyId = getTargetSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ success: false, message: "Society ID is required" });
    }

    const { title, description, event_date, event_time, location, is_active } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Event title is required" });
    }

    const activeRole = req.user.activeRole || req.user.role || "ADMIN";

    let finalLocation = location ? location.trim() : null;
    if (!finalLocation && societyId) {
      try {
        const society = await Society.findByPk(societyId);
        if (society?.name) {
          finalLocation = society.name;
        }
      } catch (err) {
        console.warn("Failed to fetch society name for default location:", err.message);
      }
    }

    // 1. Create main Event record
    const event = await Event.create({
      society_id: societyId,
      title: title.trim(),
      description: description ? description.trim() : null,
      event_date: event_date || null,
      event_time: event_time || null,
      location: finalLocation,
      is_active: is_active === "false" || is_active === false ? false : true,
      created_by_user_id: req.user.id,
      created_by_name: req.user.name || `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() || req.user.email,
      created_by_role: activeRole,
    });

    // 2. Process uploaded files
    const mediaRecords = [];
    let sortIndex = 0;

    const uploadedPhotos = req.files?.photos || [];
    const uploadedVideos = req.files?.videos || [];

    for (const photo of uploadedPhotos) {
      mediaRecords.push({
        event_id: event.id,
        media_type: "IMAGE",
        url: photo.path,
        public_id: photo.filename,
        original_name: photo.originalname,
        size_bytes: photo.size,
        sort_order: sortIndex++,
      });
    }

    for (const video of uploadedVideos) {
      mediaRecords.push({
        event_id: event.id,
        media_type: "VIDEO",
        url: video.path,
        public_id: video.filename,
        original_name: video.originalname,
        size_bytes: video.size,
        sort_order: sortIndex++,
      });
    }

    if (mediaRecords.length > 0) {
      await EventMedia.bulkCreate(mediaRecords);
    }

    // Fetch created event with media
    const createdEvent = await Event.findByPk(event.id, {
      include: [{ model: EventMedia, as: "media" }],
    });

    return res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: createdEvent,
    });
  } catch (error) {
    console.error("createEvent error:", error);
    return res.status(500).json({ success: false, message: "Failed to create event", error: error.message });
  }
};

/**
 * PUT /api/events/:id
 * Update event fields, retain/remove media, append new uploads
 */
const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const societyId = getTargetSocietyId(req);

    const event = await Event.findByPk(id, {
      include: [{ model: EventMedia, as: "media" }],
    });

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    if (societyId && event.society_id !== societyId && req.user.activeRole !== "SUPER_ADMIN") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { title, description, event_date, event_time, location, is_active, keep_media } = req.body;

    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({ success: false, message: "Event title cannot be empty" });
      }
      event.title = title.trim();
    }

    if (description !== undefined) event.description = description ? description.trim() : null;
    if (event_date !== undefined) event.event_date = event_date || null;
    if (event_time !== undefined) event.event_time = event_time || null;
    if (location !== undefined) event.location = location ? location.trim() : null;
    if (is_active !== undefined) event.is_active = is_active === "false" || is_active === false ? false : true;

    await event.save();

    // Parse retained media IDs
    let retainedIds = [];
    if (keep_media) {
      try {
        retainedIds = typeof keep_media === "string" ? JSON.parse(keep_media) : keep_media;
        retainedIds = retainedIds.map((val) => Number(val));
      } catch (e) {
        retainedIds = [];
      }
    }

    // Determine removed media
    const existingMedia = event.media || [];
    const removedMedia = existingMedia.filter((m) => !retainedIds.includes(m.id));

    for (const item of removedMedia) {
      try {
        const resourceType = item.media_type === "VIDEO" ? "video" : "image";
        await cloudinary.uploader.destroy(item.public_id, { resource_type: resourceType });
      } catch (err) {
        console.warn(`[Cloudinary Cleanup] Failed to destroy ${item.public_id}:`, err.message);
      }
      await item.destroy();
    }

    // Update sort order of remaining media
    let currentSortOrder = 0;
    const remainingMedia = existingMedia.filter((m) => retainedIds.includes(m.id));
    for (const item of remainingMedia) {
      item.sort_order = currentSortOrder++;
      await item.save();
    }

    // Append new uploaded photos and videos
    const newPhotos = req.files?.photos || [];
    const newVideos = req.files?.videos || [];
    const newMediaRecords = [];

    for (const photo of newPhotos) {
      newMediaRecords.push({
        event_id: event.id,
        media_type: "IMAGE",
        url: photo.path,
        public_id: photo.filename,
        original_name: photo.originalname,
        size_bytes: photo.size,
        sort_order: currentSortOrder++,
      });
    }

    for (const video of newVideos) {
      newMediaRecords.push({
        event_id: event.id,
        media_type: "VIDEO",
        url: video.path,
        public_id: video.filename,
        original_name: video.originalname,
        size_bytes: video.size,
        sort_order: currentSortOrder++,
      });
    }

    if (newMediaRecords.length > 0) {
      await EventMedia.bulkCreate(newMediaRecords);
    }

    const updatedEvent = await Event.findByPk(event.id, {
      include: [
        {
          model: EventMedia,
          as: "media",
          order: [["sort_order", "ASC"], ["created_at", "ASC"]],
        },
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Event updated successfully",
      data: updatedEvent,
    });
  } catch (error) {
    console.error("updateEvent error:", error);
    return res.status(500).json({ success: false, message: "Failed to update event", error: error.message });
  }
};

/**
 * DELETE /api/events/:id
 * Delete event and all child media records & Cloudinary assets
 */
const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const societyId = getTargetSocietyId(req);

    const event = await Event.findByPk(id, {
      include: [{ model: EventMedia, as: "media" }],
    });

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    if (societyId && event.society_id !== societyId && req.user.activeRole !== "SUPER_ADMIN") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const mediaList = event.media || [];

    for (const media of mediaList) {
      try {
        const resourceType = media.media_type === "VIDEO" ? "video" : "image";
        await cloudinary.uploader.destroy(media.public_id, { resource_type: resourceType });
      } catch (err) {
        console.warn(`[Cloudinary Delete Event] Failed to destroy ${media.public_id}:`, err.message);
      }
    }

    await EventMedia.destroy({ where: { event_id: event.id } });
    await event.destroy();

    return res.status(200).json({
      success: true,
      message: "Event deleted successfully",
    });
  } catch (error) {
    console.error("deleteEvent error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete event", error: error.message });
  }
};

module.exports = {
  getResidentEvents,
  getAdminEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
};
