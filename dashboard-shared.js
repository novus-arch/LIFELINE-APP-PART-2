// Shared functions and utilities for all dashboards

// To connect with server for auto refresh
const socket = io();

socket.on('refresh-page', () => {
    console.log('Refresh event received, reloading dashboard...');
    location.reload();
});

const username = localStorage.getItem('username');
const authority = localStorage.getItem('authority');
let currentTab = 'overview';

// Request notification permission on page load
if ('Notification' in window) {
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Push notiication for alarms
function showAlarmNotification(alarms) {
    alarms.forEach(alarm => {
        sendOneSignalAlarm(alarm);
    });
}

function sendOneSignalAlarm(alarm) {
    const alarmId = alarm.id || alarm._id;

    OneSignal.sendSelfNotification(
        "Emergency Alert",
        alarm.message 
            ? `${alarm.schoolId}: ${alarm.message}` 
            : `${alarm.schoolId}: Emergency in progress`,
        "https://lifeline-web-app.onrender.com",
        { tag: `alarm-${alarmId}-${alarm.updatedAt || Date.now()}` }
    );
}

// Emergency type display helper
function getEmergencyTypeDisplay(typeNum) {
    const types = {
        0: 'No Emergency',
        1: 'Type 1 - Minor',
        2: 'Type 2 - Moderate',
        3: 'Type 3 - Critical'
    };
    return types[typeNum] || 'Unknown';
}

// QR Code generation function
async function generateQRCode(text, elementId) {
    try {
        // Create a canvas for QR code
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
        
        const img = new Image();
        img.onload = function() {
            const container = document.getElementById(elementId);
            if (container) {
                container.innerHTML = '';
                container.appendChild(img);
                
                // Add download button
                const downloadBtn = document.createElement('button');
                downloadBtn.type = 'button';
                downloadBtn.className = 'btn-small btn-create';
                downloadBtn.textContent = 'Download QR Code';
                downloadBtn.style.marginTop = '10px';
                downloadBtn.onclick = function() {
                    downloadQRCode(img, text);
                };
                container.appendChild(downloadBtn);
            }
        };
        img.src = qrUrl;
    } catch (err) {
        console.error('Error generating QR code:', err);
    }
}

// Download QR code function
function downloadQRCode(imgElement, schoolId) {
    const link = document.createElement('a');
    link.href = imgElement.src;
    link.download = `lifeline-${schoolId}-qr.png`;
    link.click();
}

// Set welcome message
if(authority) {
    document.getElementById('welcomeMsg').innerText = `HELLO ${authority}!`;
}

if (!username || !authority) {
    window.location.href = '/index.html';
}

// Logout button
document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('username');
    localStorage.removeItem('authority');
    window.location.href = '/index.html';
});

// --- COMMON FUNCTIONS ---

function showCompletionForm(role, data) {
    let html = '<div class="completion-overlay">';
    html += '<div class="completion-modal">';
    html += '<h2>Complete Your Profile</h2>';
    html += '<p>Your account is incomplete. Please fill in the required information to continue.</p>';
    html += '<form id="completionForm" onsubmit="completeProfile(event, \'' + role + '\')">';

    if (role === 'student') {
        html += '<label>Email:</label>';
        html += `<input type="email" id="compEmail" placeholder="Email" value="${data.student?.email || ''}" required />`;
        html += '<label>Location:</label>';
        html += `<input type="text" id="compLocation" placeholder="Location (e.g., Building A, Room 101)" value="${data.student?.location || ''}" required />`;
        html += '<label>Emergency Contact:</label>';
        html += `<input type="text" id="compContact" placeholder="Emergency Contact Name/Number" value="${data.student?.emergencyContact || ''}" required />`;
        html += '<label>Age:</label>';
        html += `<input type="number" id="compAge" placeholder="Age" value="${data.student?.age || ''}" />`;
    } else if (role === 'staff') {
        html += '<label>Email:</label>';
        html += `<input type="email" id="compEmail" placeholder="Email" value="${data.staff?.email || ''}" required />`;
        html += '<label>Location/Office:</label>';
        html += `<input type="text" id="compLocation" placeholder="Location/Office" value="${data.staff?.location || ''}" required />`;
        html += '<label>Contact Number:</label>';
        html += `<input type="text" id="compContact" placeholder="Contact Number" value="${data.staff?.contact || ''}" required />`;
    }

    html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
    html += '<h3>Set New Password (Required)</h3>';
    html += '<label>Current Password (from account creation):</label>';
    html += '<input type="password" id="compOldPassword" placeholder="Your current password" required />';
    html += '<label>New Password:</label>';
    html += '<input type="password" id="compNewPassword" placeholder="New Password" required />';
    html += '<label>Confirm Password:</label>';
    html += '<input type="password" id="compConfirmPassword" placeholder="Confirm Password" required />';
    
    html += '<div style="margin-top: 20px;">';
    html += '<button type="submit" class="btn-create">Complete Profile & Continue</button>';
    html += '</div>';
    html += '<div id="completionMessage" style="margin-top: 10px; padding: 10px; display: none; border-radius: 5px;"></div>';
    html += '</form>';
    html += '</div>';
    html += '</div>';

    document.body.innerHTML = html + document.body.innerHTML;
}

async function completeProfile(event, role) {
    event.preventDefault();

    const email = document.getElementById('compEmail').value;
    const location = document.getElementById('compLocation').value;
    const emergencyContact = document.getElementById('compContact').value;
    const oldPassword = document.getElementById('compOldPassword').value;
    const newPassword = document.getElementById('compNewPassword').value;
    const confirmPassword = document.getElementById('compConfirmPassword').value;

    if (newPassword !== confirmPassword) {
        showCompletionMessage('Passwords do not match!', 'error');
        return;
    }

    try {
        const schoolId = localStorage.getItem('schoolId');
        
        // Update profile
        const profileResponse = await fetch(`/${role === 'student' ? 'student' : 'staff'}/${schoolId}/update-profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                location,
                ...(role === 'student' && { emergencyContact, age: document.getElementById('compAge').value }),
                ...(role === 'staff' && { contact: emergencyContact })
            })
        });

        if (!profileResponse.ok) throw new Error('Profile update failed');

        // Change password
        const passwordResponse = await fetch('/user/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: username,
                oldPassword: oldPassword,
                newPassword: newPassword
            })
        });

        if (!passwordResponse.ok) throw new Error('Password change failed');

        showCompletionMessage('Profile completed successfully! Redirecting...', 'success');
        setTimeout(() => {
            location.reload();
        }, 1500);

    } catch (error) {
        console.error('Completion error:', error);
        showCompletionMessage('Error: ' + error.message, 'error');
    }
}

function showCompletionMessage(message, type) {
    const msgEl = document.getElementById('completionMessage');
    msgEl.textContent = message;
    msgEl.style.display = 'block';
    msgEl.style.backgroundColor = type === 'error' ? '#fee' : '#efe';
    msgEl.style.color = type === 'error' ? '#c33' : '#3c3';
    msgEl.style.borderLeft = `4px solid ${type === 'error' ? '#c33' : '#3c3'}`;
}

function makeAlarm(schoolId) {
    if (confirm('Are you sure you want to create an alarm?')) {
        window.location.href = `/alarm.html?schoolId=${schoolId}`;
    }
}

