const mongoose = require('mongoose');
const studentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    faceLabel: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    rollNumber: {
      type: String,
      trim: true,
      default: '',
    },
    joiningDate: {
      type: Date,
      default: null,
    },
    department: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    cloudinaryImages: {
      type: [
        {
          publicId: {
            type: String,
            trim: true,
            default: '',
          },
          secureUrl: {
            type: String,
            trim: true,
            default: '',
          },
          width: {
            type: Number,
            default: null,
          },
          height: {
            type: Number,
            default: null,
          },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Student', studentSchema);
