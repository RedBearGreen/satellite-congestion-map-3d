const express = require('express');
const { wrapper } = require('axios-cookiejar-support');
const axios = wrapper(require('axios').create());
const tough = require('tough-cookie');
const app = express();
const port = 5000;

app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // 開発用、必要に応じて制限
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// 環境変数からSpace-Track認証情報を取得
const spaceTrackUsername = process.env.SPACE_TRACK_USERNAME || '';
const spaceTrackPassword = process.env.SPACE_TRACK_PASSWORD || '';

const cookieJar = new tough.CookieJar();

// TLEデータを取得するエンドポイント (NORAD IDをクエリで受け取る)
app.get('/api/tle', async (req, res) => {
    const noradId = req.query.norad || '25544'; // デフォルトISS
    try {
        if (!spaceTrackUsername || !spaceTrackPassword) {
            throw new Error('Space-Track credentials are not set in environment variables');
        }
        console.log('Attempting to login to Space-Track'); // ユーザー名は非表示
        // Space-Trackにログイン (クッキーを使用)
        const loginResponse = await axios.post('https://www.space-track.org/ajaxauth/login', {
            identity: spaceTrackUsername,
            password: spaceTrackPassword
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'xAI-Grok/1.0'
            },
            withCredentials: true,
            jar: cookieJar,
            maxRedirects: 0,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            }
        });

        console.log('Login response status:', loginResponse.status);
        console.log('Login response headers:', JSON.stringify(loginResponse.headers, null, 2));
        console.log('Saved cookies:', cookieJar.getCookies('https://www.space-track.org'));

        // クッキーを使ってAPIリクエスト
        const tleResponse = await axios.get(`https://www.space-track.org/basicspacedata/query/class/tle_latest/NORAD_CAT_ID/${noradId}/orderby/EPOCH%20desc/limit/1/format/json`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'xAI-Grok/1.0'
            },
            withCredentials: true,
            jar: cookieJar
        });

        console.log('Raw JSON data received:', JSON.stringify(tleResponse.data, null, 2));
        if (!tleResponse.data || tleResponse.data.length === 0) {
            throw new Error('No TLE data received from Space-Track');
        }

        // TLEデータを抽出
        const tleData = tleResponse.data[0];
        const tleLines = [tleData.TLE_LINE1, tleData.TLE_LINE2].filter(line => line && line.trim());
        if (tleLines.length < 2) {
            throw new Error('Invalid TLE data: Less than 2 lines received. Raw data: ' + JSON.stringify(tleResponse.data));
        }

        res.json({
            name: tleData.OBJECT_NAME || 'Satellite ' + noradId,
            tle1: tleLines[0],
            tle2: tleLines[1]
        });
    } catch (error) {
        console.error('Error fetching TLE:', {
            message: error.message,
            response: error.response ? error.response.status + ' ' + error.response.statusText : 'No response',
            data: error.response ? error.response.data : 'No data',
            config: error.config ? error.config.url : 'No config'
        });
        res.status(500).json({ error: 'Failed to fetch TLE data: ' + error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});