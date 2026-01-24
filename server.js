const express = require('express');
const http = require('http');
const path = require('path');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;
const cors = require('cors');
// Middle Ware

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));
app.use(cors());

// For real time refresh per alarm updates
const { Server } = require('socket.io');
const ioServer = http.createServer(app);
const io = new Server(ioServer);
io.on('connection', socket => {
  console.log('Client connected');
});

// For push notifications

async function sendAlarmNotification(alarm) {
    const student = await db.collection('students').findOne({ schoolId: alarm.schoolId });

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${process.env.REST_API_KEY}`
        },
        body: JSON.stringify({
            app_id: process.env.ONESIGNAL_APP_ID,

            headings: { en: "Emergency Alarm" },

            contents: {
                en: 
`Alarm for student ${student.name} (${alarm.schoolId}):
Location: ${student.location || 'Not provided'}
Emergency Level: Level ${alarm.emergency || 0}
Message:
${alarm.message || 'Ongoing emergency'}`
            },

            data: {
                alarmId: alarm._id.toString(),
                updatedAt: alarm.updatedAt
            },

            included_segments: ["All"]
        })
    });

    const data = await response.json();
    console.log("OneSignal push sent:", data);
}

// For password hashing
const bcrypt = require('bcrypt');

//For Database connection
const { MongoClient, ObjectId } = require('mongodb');
const { send } = require('process');
const mongoUrl = process.env.MONGODB_URI;
const dbName = 'school_alarm';
let db;

const client = new MongoClient(mongoUrl);

async function connectToMongo() {
    try {
        await client.connect();
        db = client.db(dbName);
        console.log('Connected to MongoDB Atlas');
    } catch (err) {
        console.error('MongoDB connection error:', err.message || err);
    }
}

function formatString(str) {
    const change = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;'
    };

    return str.replace(/[<>&"']/g, function(m) {
        return change[m];
    });
}

// To Login using accountName and password, and return authority and schoolId
app.post('/login', async (req, res) => {
    const {username, password} = req.body;

    // if fields are empty or incomplete
    if (!username || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'User name and password are required' 
        });
    }

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try{
        // get the user from database
        const user = await db.collection('users').findOne({ username: username });
        

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid User name or Password'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Login successful',
            username: user.username,
            authority: user.authority
        });
    }
    catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Database Error: ' + (err.message || err)
        });
    }
});

// Get current user details: USERNAME, SCHOOL ID, AUTHORITY, DEPARTMENT
app.get('/user/:username', async (req, res) => {
    if (!db) {
        return res.status(503).json({
            success: false,
            message: 'Database not connected'
        });
    }

    const { username } = req.params;

    try {
        const user = await db.collection('users').findOne({ username: username });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        let userDetails = {
            username: user.username,
            authority: user.authority,
            schoolId: user.schoolId
        };

        // Get additional details based on role
        if (user.authority === 'STUDENT') {
            const student = await db.collection('students').findOne({ schoolId: username });
            if (student) {
                userDetails.department = student.department;
            }
        } 
        
        else if (user.authority === 'STAFF') {
            const staff = await db.collection('staffs').findOne({ schoolId: username });
            if (staff) {
                userDetails.department = staff.department;
            }
        }

        res.status(200).json({
            success: true,
            user: userDetails
        });
    } 
    
    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database Error: ' + (err.message || err)
        });
    }
});

// To quickly get alarms post request and quickly handles it, also adds a record for it in the database
app.post('/alarm/:schoolId', async (req, res) => {
    // checks if database is connected
    if (!db) {
        return res.status(503).json({
            success: false,
            message: 'Database not connected'
        });
    }

    const { emergency, message, status } = req.body;
    const { schoolId } = req.params;

    // check if it has a schoolId
    if (!schoolId) {
        return res.status(400).json({
            success: false,
            message: 'schoolId is required'
        });
    }

    // check school id if it exists from the database and do actions accordingly
    try {
        // Get student info from MongoDB
        const student = await db.collection('students').findOne({ schoolId: schoolId });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        // Find if alarm exists and is active
        let alarm = await db.collection('alarms').findOne({ 
            schoolId: schoolId, 
            status: 'ongoing'
        });

        const currentTime = new Date();

        // If no active alarm, create a new one
        if (!alarm) {
            const newAlarm = {
                schoolId:       schoolId,
                emergency:      0,
                message:        '',
                status:         'ongoing',
                createdAt:      currentTime,
                lastUpdated:    currentTime,
                resolvedAt:     null,
                lastAction:     'created'
            };
            
            const insert = await db.collection('alarms').insertOne(newAlarm);
            alarm = newAlarm;
            alarm._id = insert.insertedId;
        }

        // Update existing alarm
        else {
            // update alarm fields
            alarm.emergency     = emergency || alarm.emergency;
            alarm.message       = message   || alarm.message;
            alarm.status        = status    || alarm.status;
            alarm.updatedAt     = currentTime;
            alarm.resolvedAt    = status === 'false' || status === 'resolved' ? currentTime : alarm.resolvedAt;
            alarm.lastAction    = 'updated';

            // update database
            await db.collection('alarms').updateOne({ _id: alarm._id }, {
                $set: {
                    emergency:  alarm.emergency,
                    message:    alarm.message,
                    status:     alarm.status,
                    updatedAt:  alarm.updatedAt,
                    resolvedAt: alarm.resolvedAt,
                    lastAction: alarm.lastAction
                }
            });
        }

        sendAlarmNotification(alarm);

        // return the alarm info
        io.emit('refresh-page');
        res.status(200).json({
            success: true,
            message: alarm.lastAction == 'updated' ? 'Alarm updated' : 'Alarm created',
            alarm: {
                id:             alarm._id,
                schoolId:       alarm.schoolId,
                studentInfo:    student,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            }
        });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database Error: ' + (err.message || err)
        });
    }
});

// Get specific alarm
app.get('/alarms/:schoolId', async (req, res) => {
    // checks if database is connected
    if (!db) {
        return res.status(503).json({
            success: false,
            message: 'Database not connected'
        });
    }

    const { schoolId } = req.params;

    try {
        const student = await db.collection('students').findOne({ schoolId: schoolId });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Invalid School ID'
            });
        }

        const alarm = await db.collection('alarms').findOne({
            schoolId: schoolId,
            status: 'ongoing'
        });

        if (!alarm) {
            return res.status(404).json({
                success: false,
                message: 'No active alarm for this student'
            });
        }

        res.status(200).json({
            success: true,
            alarm: {
                id:             alarm._id,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            }
        });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database Error: ' + (err.message || err)
        });
    }
});

// Get all alarms
app.get('/alarms/all', async (req, res) => {
    // checks if database is connected
    if (!db) {
        return res.status(503).json({
            success: false,
            message: 'Database not connected'
        });
    }

    try {
        const alarms = await db.collection('alarms')
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json({
        success: true,
        alarms: alarms
        });
    }

    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database Error: ' + (err.message || err)
        });
    }
});

// Student Dashboard -> gets data for the student based on their schoolId
app.get('/dashboard/student/:schoolId', async (req, res) => {
    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    const { schoolId } = req.params;

    try {
        // Get student data
        const student = await db.collection('students').findOne({ schoolId: schoolId });
        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Invalid School ID'
            });
        }

        // Get alarm for this student
        const alarm = await db.collection('alarms').findOne({
            schoolId: schoolId,
            status: 'ongoing'
        });

        res.status(200).json({
            success: true,
            role: 'student',
            student: {
                schoolId:       student.schoolId,
                name:           student.name,
                age:            student.age,
                department:     student.department,
                location:       student.location,
                email:          student.email,
                emergencyContact: student.emergencyContact,
                newuser:        !!student.newuser,
                medicalHistory: student.medicalHistory,
                allergies:      student.allergies
            },
            ongoingAlarm: alarm ? {
                id:             alarm._id,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            } : null
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({
        success: false,
        message: 'Database error'
        });
    }
});

// Staff Dashboard - show all alarms and student data at the same department
app.get('/dashboard/staff/:department', async (req, res) => {
    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        // Get all students in the same department
        const students = await db.collection('students').find({department: req.params.department}).toArray();

        // Get all ongoing alarms in the same department
        const alarms = await db.collection('alarms')
        .find({schoolId: { $in: students.map(s => s.schoolId) }})
        .sort({ updatedAt: -1 })
        .toArray();

        const ongoingAlarms = alarms.filter(alarm => alarm.status === 'ongoing');

        // Create map of alarms by schoolId for easy lookup (only for ongoing alarms)
        const alarmsByStudent = {};
        for (const alarm of ongoingAlarms) {
            alarmsByStudent[alarm.schoolId] = {
                id:             alarm._id,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            };  
        }

        // Build student table with alarm status
        const studentTable = students.map(student => ({
            schoolId:           student.schoolId,
            name:               student.name,
            age:                student.age,
            department:         student.department,
            location:           student.location,
            email:              student.email,
            emergencyContact:   student.emergencyContact,
            newuser:            !!student.newuser,
            medicalHistory:     student.medicalHistory,
            allergies:          student.allergies,
            ongoingAlarm:       alarmsByStudent[student.schoolId] || null
        }));

        // Get all staffs in the same department
        const staffs = await db.collection('staffs').find({department: req.params.department}).toArray();

        res.status(200).json({
            success:            true,
            role:               'staff',
            department:         req.params.department,
            totalStudents:      students.length,
            ongoingAlarmCount:  ongoingAlarms.length,
            students:           studentTable,
            staffs:             staffs.map(s => ({
                name:           s.name,
                schoolId:       s.schoolId,
                department:     s.department,
                age:            s.age,
                location:       s.location,
                email:          s.email,
                contact:        s.contact,
                newuser:        !!s.newuser
            })),
            ongoingAlarms:      ongoingAlarms.map(alarm => ({
                id:             alarm._id,
                student:        students.find(s => s.schoolId === alarm.schoolId) || null,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            })),
            alarms:             alarms.map(alarm => ({
                id:             alarm._id,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            })),
        });
    } 
    
    catch (err) {
        console.error('Error:', err);
        res.status(500).json({
        success: false,
        message: 'Database error'
        });
    }
});

// Admin Dashboard - show all data, student, staff, and alarms
app.get('/dashboard/admin', async (req, res) => {
    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        // Get all students
        const students = await db.collection('students').find({}).toArray();

        // Get all alarms
        const alarms = await db.collection('alarms')
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

        // Get ongoing alarms only
        const ongoingAlarms = alarms.filter(alarm => alarm.status === 'ongoing');

        // Create map of alarms by schoolId for easy lookup
        const alarmsByStudent = {};
        for (const alarm of alarms) {
            alarmsByStudent[alarm.schoolId] = {
                id:             alarm._id,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            };  
        }

        // Build student table with alarm status
        const studentTable = students.map(student => ({
            schoolId:           student.schoolId,
            name:               student.name,
            age:                student.age,
            department:         student.department,
            location:           student.location,
            email:              student.email,
            emergencyContact:   student.emergencyContact,
            newuser:            !!student.newuser,
            medicalHistory:     student.medicalHistory,
            allergies:          student.allergies,
            ongoingAlarm:       alarmsByStudent[student.schoolId] || null
        }));

        // Get all staffs
        const staffs = await db.collection('staffs').find({}).toArray();

        res.status(200).json({
            success:            true,
            role:               'admin',
            totalStudents:      students.length,
            ongoingAlarmCount:  ongoingAlarms.length,
            students:           studentTable,
            staffs:             staffs.map(s => ({
                name: s.name,
                schoolId: s.schoolId,
                department: s.department,
                age: s.age,
                location: s.location,
                email: s.email,
                contact: s.contact,
                newuser: !!s.newuser
            })),
            ongoingAlarms:      ongoingAlarms.map(alarm => ({
                id:             alarm._id,
                student:        students.find(s => s.schoolId === alarm.schoolId) || null,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            })),
            allAlarms:          alarms.map(alarm => ({
                id:             alarm._id,
                schoolId:       alarm.schoolId,   
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            })),
        });
    } 
    catch (err) {
        console.error('Error:', err);
        res.status(500).json({
        success: false,
        message: 'Database error'
        });
    }
});

// Create account for student - ADMIN or STAFF only
app.post('/dashboard/student/:schoolId', async (req, res) => {
    const { schoolId } = req.params;
    const { authority, username, password, department } = req.body;

    // Check authority
    if (authority !== 'ADMIN' && authority !== 'STAFF') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN or STAFF can create student accounts'
        });
    }

    // Check required fields
    if (!schoolId || !username || !password) {
        return res.status(400).json({
            success: false,
            message: 'schoolId, name, and password are required'
        });
    }

    // Sanitize username
    const name = formatString(username);

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        // Check if student already exists
        const existingStudent = await db.collection('students').findOne({ schoolId: schoolId });
        if (existingStudent) {
            return res.status(409).json({
                success: false,
                message: 'Student with this School ID already exists'
            });
        }

        // Check if user already exists
        const existingUser = await db.collection('users').findOne({ schoolId: schoolId });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'User with this School ID already exists'
            });
        }

        // Create new student record
        const newStudent = {
            name:               name,
            schoolId:           schoolId,
            department:         department || 'General',
            age:                null,
            location:           null,
            email:              null,
            emergencyContact:   null,
            newuser:            true,
            medicalHistory:     null,
            allergies:          null
        };

        // Create new User
        const newUser = {
            username: schoolId,
            password: await bcrypt.hash(password, 10),
            authority: 'STUDENT',
            schoolId: schoolId
        };

        await db.collection('students').insertOne(newStudent);
        await db.collection('users').insertOne(newUser);

        res.status(201).json({
            success: true,
            message: 'Student created successfully',
            student: newStudent
        });
    }
    catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Database Error: ' + (err.message || err)
        });
    }
});

// Create account for staffs - ADMIN only
app.post('/dashboard/staff/:schoolId', async (req, res) => {
    const { schoolId } = req.params;
    const { authority, username, password, department } = req.body;

    // Check authority
    if (authority !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN can create staff accounts'
        });
    }

    // Check required fields
    if (!schoolId || !username || !password) {
        return res.status(400).json({
            success: false,
            message: 'schoolId, name, and password are required'
        });
    }

    // Sanitize name
    const name = formatString(username);

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        // Check if staff already exists
        const existingStaff = await db.collection('staffs').findOne({ schoolId: schoolId });
        if (existingStaff) {
            return res.status(409).json({
                success: false,
                message: 'Staff with this School ID already exists'
            });
        }

        // Check if user already exists
        const existingUser = await db.collection('users').findOne({ username: schoolId });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'User with this School ID already exists'
            });
        }

        // Create new staff record
        const newStaff = {
            name:               name,
            schoolId:           schoolId,
            department:         department || 'General',
            age:                null,
            location:           null,
            email:              null,
            contact:            null,
            newuser:            true,
        };

        // Create new User
        const newUser = {
            username: name,
            password: await bcrypt.hash(password, 10),
            authority: 'STAFF',
            schoolId: schoolId
        };

        await db.collection('staffs').insertOne(newStaff);
        await db.collection('users').insertOne(newUser);

        res.status(201).json({
            success: true,
            message: 'Staff created successfully',
            staff: newStaff
        });
    }
    catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Database Error: ' + (err.message || err)
        });
    }
});

// Update student profile data
app.post('/student/:schoolId/update-profile', async (req, res) => {
    const { schoolId } = req.params;
    const { age, location, email, emergencyContact, medicalHistory, allergies } = req.body;

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        const updateData = {};
        if (age !== undefined && age !== null) updateData.age = age;
        if (location !== undefined && location !== null) updateData.location = location;
        if (email !== undefined && email !== null) updateData.email = email;
        if (emergencyContact !== undefined && emergencyContact !== null) updateData.emergencyContact = emergencyContact;
        if (medicalHistory !== undefined && medicalHistory !== null) updateData.medicalHistory = medicalHistory;
        if (allergies !== undefined && allergies !== null) updateData.allergies = allergies;

        const result = await db.collection('students').updateOne(
            { schoolId: schoolId },
            { $set: { ...updateData, newuser: false } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        io.emit('refresh-page');
        res.status(200).json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database error: ' + (err.message || err)
        });
    }
});

// Update staff profile data
app.post('/staff/:schoolId/update-profile', async (req, res) => {
    const { schoolId } = req.params;
    const { age, location, email, contact } = req.body;

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        const updateData = {};
        if (age !== undefined && age !== null) updateData.age = age;
        if (location !== undefined && location !== null) updateData.location = location;
        if (email !== undefined && email !== null) updateData.email = email;
        if (contact !== undefined && contact !== null) updateData.contact = contact;

        const result = await db.collection('staffs').updateOne(
            { schoolId: schoolId },
            { $set: { ...updateData, newuser: false } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Staff not found'
            });
        }

        io.emit('refresh-page');
        res.status(200).json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database error: ' + (err.message || err)
        });
    }
});

// Get staff data
app.get('/staff/:schoolId', async (req, res) => {
    const { schoolId } = req.params;

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        const staff = await db.collection('staffs').findOne({ schoolId: schoolId });

        if (!staff) {
            return res.status(404).json({
                success: false,
                message: 'Staff not found'
            });
        }

        res.status(200).json({
            success: true,
            staff: staff
        });
    }

    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database error: ' + (err.message || err)
        });
    }
});

// Get student alarm records
app.get('/student/:schoolId/alarms', async (req, res) => {
    const { schoolId } = req.params;

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        const alarms = await db.collection('alarms')
            .find({ schoolId: schoolId })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json({
            success: true,
            alarms: alarms.map(alarm => ({
                id: alarm._id,
                schoolId: alarm.schoolId,
                emergency: alarm.emergency,
                message: alarm.message,
                status: alarm.status,
                createdAt: alarm.createdAt,
                updatedAt: alarm.updatedAt,
                resolvedAt: alarm.resolvedAt,
                lastAction: alarm.lastAction
            }))
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database error: ' + (err.message || err)
        });
    }
});

// Resolve alarm by ID - ADMIN or STAFF only
app.post('/alarm/:alarmId/resolve', async (req, res) => {
    const { authority } = req.body;

    // Check authority
    if (authority !== 'ADMIN' && authority !== 'STAFF') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN or STAFF can resolve alarms'
        });
    }

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    const { alarmId } = req.params;
      
    try {
        const alarm = await db.collection('alarms').findOneAndUpdate(
            { _id: new ObjectId(alarmId) },
            {
                $set: {
                status: 'resolved',
                resolvedAt: new Date()
                }
            },
            { returnDocument: 'after' }
        );
    
        if (!alarm.value) {
            return res.status(404).json({
                success: false,
                message: 'Alarm not found'
            });
        }
    
        res.status(200).json({
            success: true,
            message: 'Alarm resolved successfully',
            alarm: alarm.value
        });
    } catch (err) {
        res.status(500).json({
        success: false,
        message: 'Database error: ' + (err.message || err)
        });
    }
});

// False alarm by ID - Student only (Note: still keeps record of it)
app.post('/alarm/:alarmId/false', async (req, res) => {
    const { authority } = req.body;
    const { alarmId } = req.params;

    // Check authority
    if (authority !== 'STUDENT') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only STUDENT can mark alarms as false'
        });
    }

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try{
        const alarm = await db.collection('alarms').findOneAndUpdate(
            { _id: new ObjectId(alarmId) },
            {
                $set: {
                status: 'false',
                resolvedAt: new Date(),
                updatedAt: new Date(),
                lastAction: 'marked as false'
                }
            },
            { returnDocument: 'after' }
        );

        if (!alarm.value) {
            return res.status(404).json({
                success: false,
                message: 'Alarm not found'
            });
        }

        io.emit('refresh-page');
        res.status(200).json({
            success: true,
            message: 'Alarm marked as false successfully',
            alarm: alarm.value
        });
    }
    catch (err) {
        res.status(500).json({
        success: false,
        message: 'Database error: ' + (err.message || err)
        });
    }
});

// Delete alarm by ID - ADMIN only (Note: only do if needed, as it removes data permanently)
app.delete('/alarm/:alarmId', async (req, res) => {
    const { authority } = req.body;
    const { alarmId } = req.params;

    // Check authority
    if (authority !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN can delete alarms'
        });
    }

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        const result = await db.collection('alarms').deleteOne({ _id: new ObjectId(alarmId) });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Alarm not found'
            });
        }

        io.emit('refresh-page');
        res.status(200).json({
            success: true,
            message: 'Alarm deleted successfully'
        });
        
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database error: ' + (err.message || err)
        });
    }
});

// Change password for users
app.post('/user/change-password', async (req, res) => {
    const { username, oldPassword, newPassword } = req.body;

    if (!username || !oldPassword || !newPassword) {
        return res.status(400).json({
            success: false,
            message: 'username, oldPassword, and newPassword are required'
        });
    }

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        const user = await db.collection('users').findOne({ username: username });
        
        // check if password is correct
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const valid = await bcrypt.compare(oldPassword, user.password);

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: 'Old password is incorrect'
            });
        }

        // hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // update in database
        await db.collection('users').updateOne(
            { username: username }, 
            { $set: { password: hashedPassword } }
        );

        res.status(200).json({
            success: true,
            message: 'Password changed successfully'
        });
    }

    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database error: ' + (err.message || err)
        })
    }
});

// Delete student by schoolId - ADMIN only
app.delete('/student/:schoolId', async (req, res) => {
    const { authority } = req.body;
    const { schoolId } = req.params;

    // Check authority
    if (authority !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN can delete students'
        });
    }

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        // Delete from students collection
        const studentResult = await db.collection('students').deleteOne({ schoolId: schoolId });
        
        // Delete user account
        const userResult = await db.collection('users').deleteOne({ username: schoolId });

        if (studentResult.deletedCount === 0 && userResult.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        io.emit('refresh-page');
        res.status(200).json({
            success: true,
            message: 'Student deleted successfully'
        });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database error: ' + (err.message || err)
        });
    }
});

// Delete staff by schoolId - ADMIN only
app.delete('/staff/:schoolId', async (req, res) => {
    const { authority } = req.body;
    const { schoolId } = req.params;

    // Check authority
    if (authority !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN can delete staff'
        });
    }

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    try {
        // Delete from staffs collection
        const staffResult = await db.collection('staffs').deleteOne({ schoolId: schoolId });
        
        // Delete user account
        const userResult = await db.collection('users').deleteOne({ username: schoolId });

        if (staffResult.deletedCount === 0 && userResult.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Staff not found'
            });
        }

        io.emit('refresh-page');
        res.status(200).json({
            success: true,
            message: 'Staff deleted successfully'
        });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database error: ' + (err.message || err)
        });
    }
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'Server is running' });
});

const server = ioServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`\nAPI Endpoints:`);
    console.log(`   POST    /login              - Login with accountName and password`);
    console.log(`   GET     /user/:username     - Get Data based on username`);
    console.log(`   POST    /alarm/:schoolId    - Create or update alarm with schoolId`);
    console.log(`   GET     /alarm/:alarmId     - Get alarm data by alarm ID`);
    console.log(`   GET     /alarms/all         - Get all alarms`);
    console.log(`   GET     /dashboard/student/:schoolId - Get student dashboard data`);
    console.log(`   GET     /dashboard/staff/:department - Get staff dashboard data`);
    console.log(`   GET     /dashboard/admin    - Get admin dashboard data`);
    console.log(`   POST    /dashboard/student/:schoolId - Create student account (ADMIN/STAFF only)`);
    console.log(`   POST    /dashboard/staff/:schoolId   - Create staff account (ADMIN only)`);
    console.log(`   POST    /student/:schoolId/update-profile - Update student profile`);
    console.log(`   POST    /staff/:schoolId/update-profile   - Update staff profile`);
    console.log(`   GET     /staff/:schoolId    - Get staff data`);
    console.log(`   GET     /student/:schoolId/alarms - Get student alarm records`);
    console.log(`   POST    /alarm/:alarmId/resolve - Resolve alarm (ADMIN/STAFF only)`);
    console.log(`   POST    /alarm/:alarmId/false   - Mark alarm as false (STUDENT only)`);
    console.log(`   DELETE  /alarm/:alarmId     - Delete alarm (ADMIN only)`);
    console.log(`   POST    /user/change-password - Change user password`);
    console.log(`   DELETE  /student/:schoolId  - Delete student (ADMIN only)`);
    console.log(`   DELETE  /staff/:schoolId    - Delete staff (ADMIN only)`);
    console.log(`   GET     /health             - Health check endpoint\n`);
});

// Attempt to connect to MongoDB in background
connectToMongo();

// To shutdown gracefully and to close client
process.on('SIGINT', async () => {
    console.log('\nShutting down server...');
    await client.close();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
