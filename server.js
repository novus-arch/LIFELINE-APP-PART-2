const express = require('express');
const http = require('http');
const path = require('path');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// For real time refresh per alarm updates
const { Server } = require('socket.io');
const ioServer = http.createServer(app);
const io = new Server(ioServer);
io.on('connection', socket => {
  console.log('Client connected');
});

// For password hashing
const bcrypt = require('bcrypt');

//For Database connection
const { MongoClient, ObjectId } = require('mongodb');
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

// To Login using accountName and password, and display correct Authority
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

// Get current user details
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
            authority: user.authority
        };

        // Get additional details based on role
        if (user.authority === 'STUDENT') {
            const student = await db.collection('students').findOne({ schoolId: username });
            if (student) {
                userDetails.department = student.department;
            }
        } else if (user.authority === 'STAFF') {
            const staff = await db.collection('staffs').findOne({ schoolId: username });
            if (staff) {
                userDetails.department = staff.department;
            }
        }

        res.status(200).json({
            success: true,
            user: userDetails
        });
    } catch (err) {
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
                schoolId:   schoolId,
                emergency: false,
                message: {
                    type: '',
                    additionalInfo: ''
                },
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

// Get specific student alarm
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

// Get all alarms as an array
app.get('/alarms', async (req, res) => {
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
            .sort({ updatedAt: -1 })
            .toArray();

        const alarmsWithStudents = await Promise.all(
            alarms.map(async (alarm) => {
                const student = await db.collection('students').findOne({ schoolId: alarm.schoolId });
                return {
                    id: alarm._id,
                    schoolId: alarm.schoolId,
                    studentInfo: student,
                    emergency: alarm.emergency,
                    message: alarm.message,
                    status: alarm.status,
                    createdAt: alarm.createdAt,
                    updatedAt: alarm.updatedAt,
                    resolvedAt: alarm.resolvedAt
                };
            })
        );

        res.status(200).json({
        success: true,
        alarms: alarmsWithStudents
        });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            message: 'Database Error: ' + (err.message || err)
        });
    }
});

// Get all ongoing alarms
app.get('/alarms/ongoing', async (req, res) => {
    // checks if database is connected
    if (!db) {
        return res.status(503).json({
            success: false,
            message: 'Database not connected'
        });
    }

    try {
        const alarms = await db.collection('alarms')
            .find({ status: 'ongoing' })
            .sort({ updatedAt: -1 })
            .toArray();

        const alarmsWithStudents = await Promise.all(
            alarms.map(async (alarm) => {
                const student = await db.collection('students').findOne({ schoolId: alarm.schoolId });
                return {
                    id: alarm._id,
                    schoolId: alarm.schoolId,
                    studentInfo: student,
                    emergency: alarm.emergency,
                    message: alarm.message,
                    status: alarm.status,
                    createdAt: alarm.createdAt,
                    updatedAt: alarm.updatedAt,
                    resolvedAt: alarm.resolvedAt
                };
            })
        );

        res.status(200).json({
        success: true,
        alarms: alarmsWithStudents
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
        .find({schoolId: { $in: students.map(s => s.schoolId) }, status: 'ongoing' })
        .sort({ updatedAt: -1 })
        .toArray();

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
            ongoingAlarmCount:  alarms.length,
            students:           studentTable,
            staffs:             staffs,
            ongoingAlarms: alarms.map(alarm => ({
                id:             alarm._id,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            }))
        });
    } catch (err) {
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

        // Get all ongoing alarms
        const alarms = await db.collection('alarms')
        .find({ status: 'ongoing' })
        .sort({ updatedAt: -1 })
        .toArray();

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
            ongoingAlarmCount:  alarms.length,
            students:           studentTable,
            staffs:             staffs,
            ongoingAlarms: alarms.map(alarm => ({
                id:             alarm._id,
                schoolId:       alarm.schoolId,
                emergency:      alarm.emergency,
                message:        alarm.message,
                status:         alarm.status,
                createdAt:      alarm.createdAt,
                updatedAt:      alarm.updatedAt,
                resolvedAt:     alarm.resolvedAt,
                lastAction:     alarm.lastAction
            }))
        });
    } catch (err) {
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
    const { authority, username, department } = req.body;

    // Check authority
    if (authority !== 'ADMIN' && authority !== 'STAFF') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN or STAFF can create student accounts'
        });
    }

    // Check required fields
    if (!schoolId || !username || !department) {
        return res.status(400).json({
            success: false,
            message: 'schoolId, name, and department are required'
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

        // Create new student record
        const newStudent = {
            name:               name,
            schoolId:           schoolId,
            department:         department,
            age:                null,
            location:           null,
            email:              null,
            emergencyContact:   null,
            medicalHistory:     null,
            allergies:          null
        };

        // Create new User
        const newPassword = `${department}${schoolId}`
        const newUser = {
            username: schoolId,
            password: await bcrypt.hash(newPassword, 10),
            authority: 'STUDENT'
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
    const { authority, username, department } = req.body;

    // Check authority
    if (authority !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN can create staff accounts'
        });
    }

    // Check required fields
    if (!schoolId || !username || !department) {
        return res.status(400).json({
            success: false,
            message: 'schoolId, name, and department are required'
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

        // Create new staff record
        const newStaff = {
            name:               name,
            schoolId:           schoolId,
            department:         department,
            age:                null,
            location:           null,
            email:              null,
            contact:            null,
        };

        // Create new User
        const newPassword = `${department}${schoolId}`
        const newUser = {
            username: schoolId,
            password: await bcrypt.hash(newPassword, 10),
            authority: 'STAFF'
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
    const { authority, deleteCode } = req.body;
    const { alarmId } = req.params;

    // Check authority
    if (authority !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN can delete alarms'
        });
    }
    if (deleteCode !== process.env.DELETE_CODE) {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Invalid delete code'
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

// Delete account for students and staff - ADMIN or STAFF only
app.delete('/user/:username', async (req, res) => {
    const { authority, deleteCode } = req.body;
    const { username } = req.params;

    if ( authority != 'ADMIN' && authority != 'STAFF') {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Only ADMIN or STAFF can delete users'
        });
    }

    if ( deleteCode !== process.env.DELETE_CODE ) {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Invalid delete code'
        });
    }

    if (!db) {
        return res.status(503).json({ 
            success: false, 
            message: 'Database not connected' 
        });
    }

    if ( !username ) {
        return res.status(400).json({
            success: false,
            message: 'Username is required'
        });
    }

    try {
        const user = await db.collection('users').findOne({ username: username });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (user.authority === 'ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Cannot delete ADMIN accounts'
            });
        }

        if (user.authority === 'STAFF' && authority !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Only ADMIN can delete STAFF accounts'
            });
        }

        const result = await db.collection('users').deleteOne({ username: username });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        io.emit('refresh-page');
        res.status(200).json({
            success: true,
            message: 'User deleted successfully'
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
    console.log(`   POST    /alarm              - Create or update alarm with schoolId`);
    console.log(`   GET     /alarm/:schoolId    - Get specific student alarm`);
    console.log(`   GET     /alarms             - Get all active alarms`);
    console.log(`   GET     /dashboard/student/:schoolId    - Student dashboard`);
    console.log(`   GET     /dashboard/staff/:department    - Staff dashboard with students and alarms in their department`);
    console.log(`   GET     /dashboard/admin                - Admin dashboard with all students and alarms`);
    console.log(`   POST    /dashboard/student/:schoolId    - Create student account (ADMIN or STAFF only)`);
    console.log(`   POST    /dashboard/staff/:schoolId      - Create staff account (ADMIN only)`);
    console.log(`   POST    /alarm/:alarmId/resolve         - Resolve alarm by ID (ADMIN or STAFF only)`);
    console.log(`   POST    /alarm/:alarmId/false           - Mark alarm as false by ID (STUDENT only)`);
    console.log(`   DELETE  /alarm/:alarmId                 - Delete alarm by ID (ADMIN only)`);
    console.log(`   GET     /health                         - Health check\n`);
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
