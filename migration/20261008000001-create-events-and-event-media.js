'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Create `events` table
    await queryInterface.createTable("events", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      society_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "societies",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      event_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      event_time: {
        type: Sequelize.TIME,
        allowNull: true,
      },
      location: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      created_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      created_by_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_by_role: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // 2. Create `event_media` table
    await queryInterface.createTable("event_media", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      event_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "events",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      media_type: {
        type: Sequelize.ENUM("IMAGE", "VIDEO"),
        allowNull: false,
        defaultValue: "IMAGE",
      },
      url: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      public_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      thumb_url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      original_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      size_bytes: {
        type: Sequelize.BIGINT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // Indexes
    await queryInterface.addIndex("events", ["society_id"], {
      name: "idx_events_society",
    });
    await queryInterface.addIndex("events", ["society_id", "is_active"], {
      name: "idx_events_society_active",
    });
    await queryInterface.addIndex("events", ["society_id", "event_date"], {
      name: "idx_events_society_date",
    });
    await queryInterface.addIndex("event_media", ["event_id", "sort_order"], {
      name: "idx_event_media_event",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("event_media");
    await queryInterface.dropTable("events");
  },
};
