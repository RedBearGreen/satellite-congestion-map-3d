const { default: wrapper } = require('axios-cookiejar-support');
const axios = wrapper(require('axios').create());
const tough = require('tough-cookie');
module.exports = (req, res) => {
    const spaceTrackUsername = process.env.SPACE_TRACK_USERNAME || '';
    const spaceTrackPassword = process.env.SPACE_TRACK_PASSWORD || '';
    const cesiumAccessToken = process.env.CESIUM_ACCESS_TOKEN || '';
    const cookieJar = new tough.CookieJar();
    // Cesiumトークンを返す
    if (req.url === '/api/cesium-token') {
        if (cesiumAccessToken) {
            res.status(200).send(cesiumAccessToken);
        } else {
            res.status(500).json({ error: 'Cesium access token not set' });
        }
        return;
    }
    // TLEデータを取得
    const noradId = req.query.norad || '25544';
    if (!spaceTrackUsername || !spaceTrackPassword) {
        res.status(500).json({ error: 'Space-Track credentials are not set' });
        return;
    }
    (async () => {
        try {
            console.log('Attempting to login to Space-Track');
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
                validateStatus: status => status >= 200 && status < 400
            });
            if (loginResponse.status !== 200) {
                throw new Error(`Login failed with status: ${loginResponse.status}`);
            }
            const tleResponse = await axios.get(`https://www.space-track.org/basicspacedata/query/class/tle_latest/NORAD_CAT_ID/${noradId}/orderby/EPOCH%20desc/limit/1/format/json`, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'xAI-Grok/1.0'
                },
                withCredentials: true,
                jar: cookieJar
            });
            if (!tleResponse.data || tleResponse.data.length === 0) {
                throw new Error('No TLE data received from Space-Track');
            }
            const tleData = tleResponse.data[0];
            const tleLines = [tleData.TLE_LINE1, tleData.TLE_LINE2].filter(line => line && line.trim());
            if (tleLines.length < 2) {
                throw new Error('Invalid TLE data: Less than 2 lines received');
            }
            res.status(200).json({
                name: tleData.OBJECT_NAME || `Satellite ${noradId}`,
                tle1: tleLines[0],
                tle2: tleLines[1]
            });
        } catch (error) {
            console.error('Error fetching TLE:', {
                message: error.message,
                response: error.response ? `${error.response.status} ${error.response.statusText}` : 'No response',
                data: error.response ? error.response.data : 'No data',
                config: error.config ? error.config.url : 'No config'
            });
            res.status(500).json({ error: 'Failed to fetch TLE data: ' + error.message });
        }
    })();
};
