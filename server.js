const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ==================== MongoDB Connection ====================
console.log('🔌 Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err.message));

// ==================== Lead Schema ====================
const leadSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  name: { type: String, default: '' },
  branch: { type: String, default: 'Usmanpura' },
  testType: { type: String, default: '' },
  testDetails: { type: String, default: '' },
  executiveAssigned: { type: String, default: '' },
  executivePhone: { type: String, default: '' },
  status: {
    type: String,
    enum: ['new', 'assigned', 'converted', 'waiting', 'not_converted'],
    default: 'new'
  },
  source: { type: String, default: 'WATI_Campaign' },
  campaign: { type: String, default: 'health_checkup' },
  whatsappMessageId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Lead = mongoose.model('Lead', leadSchema);

// ==================== Executive Configuration ====================
const executives = [
  { name: 'Aditi', phone: '8488931212', whatsapp: '8488931212', active: true, leadCount: 0 },
  { name: 'Khyati', phone: '7490029085', whatsapp: '7490029085', active: true, leadCount: 0 },
  { name: 'Jay', phone: '9274682553', whatsapp: '9274682553', active: true, leadCount: 0 },
  { name: 'Mital', phone: '9558591212', whatsapp: '9558591212', active: true, leadCount: 0 }
];

let currentExecutiveIndex = 0;

function getNextExecutive() {
  const activeExecs = executives.filter(e => e.active);
  if (activeExecs.length === 0) return null;
  const exec = activeExecs[currentExecutiveIndex % activeExecs.length];
  currentExecutiveIndex++;
  return exec;
}

// ==================== WATI API Configuration ====================
const WATI_BASE_URL = process.env.WATI_API_URL || 'https://live-mt-server.wati.io';
const WATI_API_KEY = process.env.WATI_API_KEY;

// Send WhatsApp Template Message
async function sendWatiTemplate(phoneNumber, templateName, params = []) {
  try {
    const url = `${WATI_BASE_URL}/api/v1/sendTemplateMessages`;
    
    const parameters = params.map(p => ({ name: p.name, value: p.value }));
    
    const payload = {
      template_name: templateName,
      broadcast_name: `Health_Campaign_${Date.now()}`,
      receivers: [phoneNumber],
      parameters: parameters
    };
    
    console.log(`📤 Sending template to ${phoneNumber}: ${templateName}`);
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Template sent to ${phoneNumber}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send template to ${phoneNumber}:`);
    if (error.response?.data) {
      console.error('Error Details:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

// Send Text Message (Session Message)
async function sendWatiText(phoneNumber, text) {
  try {
    const url = `${WATI_BASE_URL}/api/v1/sendSessionMessage/${phoneNumber}`;
    const payload = { text };
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Text sent to ${phoneNumber}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send text to ${phoneNumber}:`);
    if (error.response?.data) {
      console.error('Error Details:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

// ==================== Webhook: WATI Incoming Message ====================
app.post('/webhook/wati', async (req, res) => {
  console.log('\n📨 ========== WATI WEBHOOK RECEIVED ==========');
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    const messageData = req.body;
    
    // Extract phone number - handle different formats
    let phoneNumber = messageData.waId || messageData.phoneNumber || messageData.from;
    
    // Extract message text
    let message = messageData.text || messageData.message;
    
    // Handle button clicks (Quick Reply)
    if (messageData.buttonReply && messageData.buttonReply.text) {
      message = messageData.buttonReply.text;
      console.log(`🔘 Quick Reply Button: ${message}`);
    }
    
    // Handle interactive button clicks
    if (messageData.interactiveButtonReply && messageData.interactiveButtonReply.title) {
      message = messageData.interactiveButtonReply.title;
      console.log(`🔘 Interactive Button: ${message}`);
    }
    
    // Handle list reply
    if (messageData.listReply && messageData.listReply.title) {
      message = messageData.listReply.title;
      console.log(`📋 List Reply: ${message}`);
    }
    
    console.log(`📞 Phone: ${phoneNumber}`);
    console.log(`💬 Message: ${message}`);
    console.log(`📝 Type: ${messageData.type}`);
    
    if (!phoneNumber) {
      console.log('⚠️ No phone number in webhook');
      return res.status(200).send('OK');
    }
    
    // Clean phone number - remove +91 and non-digits
    phoneNumber = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    console.log(`📱 Cleaned Phone: ${phoneNumber}`);
    
    // Check if it's a campaign trigger (Book Now)
    const isBookNow = message && (
      message.toLowerCase() === 'book now' || 
      message.toLowerCase().includes('book now') ||
      message.toLowerCase() === 'book' ||
      message.toLowerCase().includes('book karo')
    );
    
    if (isBookNow) {
      console.log('🎯 Campaign trigger detected!');
      await handleCampaignLead(phoneNumber);
    } else if (message && message.trim().length > 0) {
      await handlePatientReply(phoneNumber, message);
    } else {
      console.log('⚠️ Empty message, ignoring');
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).send('OK');
  }
});

// Handle New Campaign Lead
async function handleCampaignLead(phoneNumber) {
  console.log('\n🎯 ========== NEW CAMPAIGN LEAD ==========');
  console.log(`📱 Phone: ${phoneNumber}`);
  console.log(`⏰ Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  
  // Check if lead already exists
  const existingLead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (existingLead) {
    console.log(`⚠️ Lead already exists for ${phoneNumber}`);
    console.log(`   Status: ${existingLead.status}`);
    console.log(`   Executive: ${existingLead.executiveAssigned}`);
    return;
  }
  
  // Assign executive via round robin
  const executive = getNextExecutive();
  if (!executive) {
    console.log('❌ No active executives available!');
    return;
  }
  
  console.log(`👤 Assigned Executive: ${executive.name}`);
  console.log(`📞 Executive Phone: ${executive.whatsapp}`);
  
  // Create lead in database
  const lead = new Lead({
    phoneNumber,
    branch: 'Usmanpura',
    source: 'WATI_Campaign',
    campaign: 'health_checkup',
    executiveAssigned: executive.name,
    executivePhone: executive.whatsapp,
    status: 'assigned'
  });
  
  await lead.save();
  console.log(`✅ Lead saved to database`);
  console.log(`   Lead ID: ${lead._id}`);
  
  // Get template names from environment variables
  const leadTemplate = process.env.LEAD_TEMPLATE_NAME || 'health_checkup_welcome';
  const execTemplate = process.env.EXECUTIVE_TEMPLATE_NAME || 'executive_lead_notification';
  
  // Get links from environment variables
  const mammographyLink = process.env.MAMMOGRAPHY_LINK || 'https://www.nibib.nih.gov/sites/default/files/2022-05/Fact-Sheet-Mammography.pdf';
  const dexaLink = process.env.DEXA_LINK || 'https://www.youtube.com/watch?v=HkLuviUi8Mc';
  const bloodPackageLink = process.env.BLOOD_PACKAGE_LINK || 'https://www.airmedlabs.com/';
  const bookingLink = process.env.BOOKING_LINK || `https://wa.me/${phoneNumber}?text=I%20want%20to%20book%20a%20test`;
  
  // Send welcome template to customer
  console.log(`📤 Sending welcome template to customer: ${phoneNumber}`);
  console.log(`   Template: ${leadTemplate}`);
  
  await sendWatiTemplate(phoneNumber, leadTemplate, [
    { name: '1', value: mammographyLink },
    { name: '2', value: dexaLink },
    { name: '3', value: bloodPackageLink },
    { name: '4', value: bookingLink }
  ]);
  
  // Send notification to executive
  console.log(`📤 Sending notification to executive: ${executive.whatsapp}`);
  console.log(`   Template: ${execTemplate}`);
  
  const callLink = `tel:+91${executive.phone}`;
  const whatsappChatLink = `https://wa.me/${executive.whatsapp}?text=Hi%20${encodeURIComponent(executive.name)}%2C%20New%20lead%20from%20health%20campaign%3A%20${phoneNumber}`;
  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  
  await sendWatiTemplate(executive.whatsapp, execTemplate, [
    { name: '1', value: phoneNumber },
    { name: '2', value: callLink },
    { name: '3', value: whatsappChatLink },
    { name: '4', value: currentTime }
  ]);
  
  console.log(`✅ Lead processing complete for ${phoneNumber}`);
  executive.leadCount++;
  console.log(`📊 Executive ${executive.name} now has ${executive.leadCount} leads`);
}

// Handle Patient Replies
async function handlePatientReply(phoneNumber, message) {
  console.log(`💬 Patient reply from ${phoneNumber}: ${message}`);
  
  const lead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  
  if (!lead) {
    console.log(`⚠️ No lead found for ${phoneNumber} - this might be from another campaign`);
    return;
  }
  
  console.log(`📝 Updating lead: ${lead._id}`);
  console.log(`   Current test type: ${lead.testType || 'none'}`);
  console.log(`   Current test details: ${lead.testDetails || 'none'}`);
  
  // Simple classification of test types
  const msgLower = message.toLowerCase();
  
  if (msgLower.includes('mammography') || msgLower.includes('mammo')) {
    lead.testType = 'Mammography';
    console.log(`✅ Updated test type: Mammography`);
  } else if (msgLower.includes('dexa') || msgLower.includes('bone') || msgLower.includes('bmd')) {
    lead.testType = 'DEXA';
    console.log(`✅ Updated test type: DEXA`);
  } else if (msgLower.includes('blood') || msgLower.includes('package') || msgLower.includes('multisystem')) {
    lead.testType = 'Blood Package';
    console.log(`✅ Updated test type: Blood Package`);
  } else if (msgLower.includes('mri')) {
    lead.testType = 'MRI';
    console.log(`✅ Updated test type: MRI`);
  } else if (msgLower.includes('ct')) {
    lead.testType = 'CT Scan';
    console.log(`✅ Updated test type: CT Scan`);
  } else if (msgLower.includes('xray') || msgLower.includes('x-ray')) {
    lead.testType = 'X-Ray';
    console.log(`✅ Updated test type: X-Ray`);
  } else if (message.length > 3 && !lead.testDetails && lead.testType) {
    // If we have test type but no details, save this as details
    lead.testDetails = message;
    console.log(`✅ Updated test details: ${message}`);
  } else if (message.length > 3 && !lead.name) {
    // If no name yet, this might be name
    lead.name = message;
    console.log(`✅ Updated name: ${message}`);
  }
  
  lead.updatedAt = new Date();
  await lead.save();
  console.log(`✅ Lead updated successfully`);
  
  // Notify executive about patient reply
  const execPhone = lead.executivePhone;
  if (execPhone) {
    const replyPreview = message.length > 80 ? message.substring(0, 80) + '...' : message;
    const replyMsg = `📩 *Patient Update*\n\n👤 Patient: ${phoneNumber}\n💬 Reply: "${replyPreview}"\n\n💬 Tap to chat: https://wa.me/${phoneNumber}`;
    
    console.log(`📤 Notifying executive: ${execPhone}`);
    await sendWatiText(execPhone, replyMsg);
  } else {
    console.log(`⚠️ No executive phone found for lead`);
  }
}

// ==================== Dashboard API Endpoints ====================

// Get all leads with filters
app.get('/api/leads', async (req, res) => {
  try {
    const { status, executive, limit = 100, skip = 0 } = req.query;
    let filter = { campaign: 'health_checkup' };
    
    if (status && status !== 'all') filter.status = status;
    if (executive && executive !== 'all') filter.executiveAssigned = executive;
    
    const leads = await Lead.find(filter)
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));
    
    const total = await Lead.countDocuments(filter);
    
    res.json({ 
      success: true, 
      data: leads, 
      total,
      page: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
      pages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    const totalLeads = await Lead.countDocuments({ campaign: 'health_checkup' });
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLeads = await Lead.countDocuments({ 
      campaign: 'health_checkup', 
      createdAt: { $gte: today } 
    });
    
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const weekLeads = await Lead.countDocuments({ 
      campaign: 'health_checkup', 
      createdAt: { $gte: lastWeek } 
    });
    
    const converted = await Lead.countDocuments({ 
      campaign: 'health_checkup', 
      status: 'converted' 
    });
    
    const waiting = await Lead.countDocuments({ 
      campaign: 'health_checkup', 
      status: 'waiting' 
    });
    
    const notConverted = await Lead.countDocuments({ 
      campaign: 'health_checkup', 
      status: 'not_converted' 
    });
    
    const assigned = await Lead.countDocuments({ 
      campaign: 'health_checkup', 
      status: 'assigned' 
    });
    
    const newLeads = await Lead.countDocuments({ 
      campaign: 'health_checkup', 
      status: 'new' 
    });
    
    // Executive performance
    const executiveStats = [];
    for (const exec of executives) {
      const execLeads = await Lead.countDocuments({ 
        campaign: 'health_checkup', 
        executiveAssigned: exec.name 
      });
      const execConverted = await Lead.countDocuments({ 
        campaign: 'health_checkup', 
        executiveAssigned: exec.name, 
        status: 'converted' 
      });
      const execWaiting = await Lead.countDocuments({ 
        campaign: 'health_checkup', 
        executiveAssigned: exec.name, 
        status: 'waiting' 
      });
      const execNotConverted = await Lead.countDocuments({ 
        campaign: 'health_checkup', 
        executiveAssigned: exec.name, 
        status: 'not_converted' 
      });
      
      executiveStats.push({
        name: exec.name,
        phone: exec.phone,
        totalLeads: execLeads,
        converted: execConverted,
        waiting: execWaiting,
        notConverted: execNotConverted,
        conversionRate: execLeads > 0 ? ((execConverted / execLeads) * 100).toFixed(1) : 0
      });
    }
    
    res.json({ 
      success: true, 
      stats: { 
        totalLeads, 
        todayLeads, 
        weekLeads,
        converted, 
        waiting, 
        notConverted, 
        assigned,
        new: newLeads
      }, 
      executiveStats 
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update lead status
app.put('/api/leads/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const lead = await Lead.findByIdAndUpdate(
      req.params.id, 
      { status, updatedAt: new Date() }, 
      { new: true }
    );
    
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    
    res.json({ success: true, data: lead });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single lead
app.get('/api/leads/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    res.json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get executive list
app.get('/api/executives', async (req, res) => {
  try {
    const execList = executives.map(exec => ({
      name: exec.name,
      phone: exec.phone,
      active: exec.active,
      currentLeadCount: exec.leadCount
    }));
    res.json({ success: true, data: execList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset executive counters
app.post('/api/executives/reset', async (req, res) => {
  try {
    executives.forEach(exec => exec.leadCount = 0);
    currentExecutiveIndex = 0;
    res.json({ success: true, message: 'Executive counters reset' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 HEALTH CAMPAIGN SERVER STARTED');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/wati`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log('='.repeat(60));
  console.log('📌 Configuration Status:');
  console.log(`   MongoDB: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Not Connected'}`);
  console.log(`   WATI API: ${WATI_API_KEY ? '✅ Key Set' : '❌ Missing'}`);
  console.log(`   WATI URL: ${WATI_BASE_URL}`);
  console.log(`   Lead Template: ${process.env.LEAD_TEMPLATE_NAME || 'health_checkup_welcome'}`);
  console.log(`   Executive Template: ${process.env.EXECUTIVE_TEMPLATE_NAME || 'executive_lead_notification'}`);
  console.log('='.repeat(60));
  console.log('👥 Executives (Round Robin):');
  executives.forEach((exec, i) => {
    console.log(`   ${i+1}. ${exec.name} - ${exec.phone}`);
  });
  console.log('='.repeat(60));
});
