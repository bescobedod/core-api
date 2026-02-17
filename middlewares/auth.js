const jwt = require('jsonwebtoken');
require('dotenv').config();
const SECRET = process.env.DB_SECRET_KEY

//middleware para autenticación por token
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];

    if(!authHeader){
        return res.status(401).json({
            code: 'TOKEN_REQUIRED',
            error: 'Token requerido'
        });
    }

    const [scheme, token] = authHeader.split(' ');
    if(scheme !== 'Bearer' || !token){
        return res.status(401).json({
            code: 'TOKEN_INVALID',
            error: 'Token inválido'
        });
    }
    
    try {
        const decoded = jwt.verify(token, SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if(err.name == 'TokenExpiredError') {
            return res.status(401).json({
                code: 'TOKEN_EXPIRED',
                error: 'Token no válido o expirado',
                details: err.message,
                expiredAt: err.expiredAt
            });
        }
        
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ code: 'TOKEN_INVALID', error: 'Token inválido' });
        }

        return res.status(500).json({
            code: 'TOKEN_VERIFICATION_ERROR',
            error: 'Error verificando token',
            details: err.message
        });
    }
}

module.exports = authMiddleware;