use std::fmt;
use wasm_bindgen::prelude::*;

/// 因数分解エンジン内で発生し得るエラーを定義する列挙型。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FactorizationError {
    /// 入力値が不正な場合
    InvalidInput(String),
    /// SIQS のふるい領域制限 (Sieve limit) が小さすぎる場合
    SieveLimitTooSmall(String),
    /// ファクターベースの要素数が不足している場合
    FactorBaseTooSmall(String),
    /// ファクターベースに 0 が含まれている場合
    FactorBaseContainsZero(String),
    /// 計算処理がアボートされた場合
    CalculationAborted,
    /// 内部で致命的な計算エラーが発生した場合
    InternalError(String),
}

impl fmt::Display for FactorizationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(msg) => write!(f, "Invalid input: {}", msg),
            Self::SieveLimitTooSmall(msg) => write!(f, "Sieve limit too small: {}", msg),
            Self::FactorBaseTooSmall(msg) => write!(f, "Factor base too small: {}", msg),
            Self::FactorBaseContainsZero(msg) => write!(f, "Factor base contains zero: {}", msg),
            Self::CalculationAborted => write!(f, "Calculation aborted"),
            Self::InternalError(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for FactorizationError {}

impl From<FactorizationError> for JsValue {
    fn from(err: FactorizationError) -> Self {
        JsValue::from_str(&err.to_string())
    }
}
