// Shared functions and utilities for all dashboards

const username = localStorage.getItem('username');
const authority = localStorage.getItem('authority');
let currentTab = 'overview';

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

const socket = io();

socket.on('refresh-page', () => {
    console.log('Refresh event received, reloading dashboard...');
    location.reload();
});

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

function switchTab(tabName) {
    currentTab = tabName;
    
    // Update active button
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    showTab(tabName);
}

function makeAlarm(schoolId) {
    if (confirm('Are you sure you want to create an alarm?')) {
        window.location.href = `/alarm.html?schoolId=${schoolId}`;
    }
}

async function createAccount(event, type) {
    event.preventDefault();
    
    let name, schoolId, password, department;
    
    if (type === 'student') {
        name = document.getElementById('studentName').value;
        schoolId = document.getElementById('studentSchoolId').value;
        password = document.getElementById('studentPassword').value;
        department = document.getElementById('studentDept').value || 'General';
    } else if (type === 'staff') {
        name = document.getElementById('staffName').value;
        schoolId = document.getElementById('staffSchoolId').value;
        password = document.getElementById('staffPassword').value;
        department = document.getElementById('staffDept').value || 'General';
    }

    const endpoint = type === 'student' ? `/dashboard/student/${schoolId}` : `/dashboard/staff/${schoolId}`;
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: name,
                password: password,
                authority: authority,
                department: department
            })
        });

        const data = await response.json();
        const messageDiv = document.getElementById('createMessage');

        if (data.success) {
            messageDiv.style.backgroundColor = '#d4edda';
            messageDiv.style.color = '#155724';
            messageDiv.textContent = `✓ ${data.message}`;
            messageDiv.style.display = 'block';
            
            // Reset form
            if (type === 'student') {
                document.getElementById('createStudentForm').reset();
            } else {
                document.getElementById('createStaffForm').reset();
            }
            
            // Reload dashboard after 2 seconds
            setTimeout(() => location.reload(), 2000);
        } else {
            messageDiv.style.backgroundColor = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.textContent = `✗ ${data.message}`;
            messageDiv.style.display = 'block';
        }
    } catch (err) {
        const messageDiv = document.getElementById('createMessage');
        messageDiv.style.backgroundColor = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = `✗ Error: ${err.message}`;
        messageDiv.style.display = 'block';
    }
}

async function deleteRecord(type, identifier) {
    if (!confirm(`Are you sure you want to delete this ${type}? This action cannot be undone.`)) {
        return;
    }

    try {
        let endpoint = '';
        
        if (type === 'alarm') {
            endpoint = `/alarm/${identifier}`;
        } else if (type === 'student') {
            endpoint = `/student/${identifier}`;
        } else if (type === 'staff') {
            endpoint = `/staff/${identifier}`;
        }

        const response = await fetch(endpoint, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                authority: authority
            })
        });

        const data = await response.json();

        if (data.success) {
            alert(`✓ ${data.message}`);
            location.reload();
        } else {
            alert(`✗ Error: ${data.message}`);
        }
    } catch (err) {
        alert(`✗ Error: ${err.message}`);
    }
}
