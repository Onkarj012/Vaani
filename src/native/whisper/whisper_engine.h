#ifndef WHISPER_ENGINE_H
#define WHISPER_ENGINE_H

#include <napi.h>
#include <string>
#include <vector>

namespace vaani {
namespace whisper {

#ifdef VAANI_HAS_WHISPER
bool WhisperLoadModel(const char* modelPath);
bool WhisperTranscribe(const float* pcmData, int nSamples, int sampleRate, char* output, int maxLen);
bool WhisperIsModelLoaded();
void WhisperFreeModel();
std::vector<std::string> WhisperListModels(const char* modelsDir);
#else
inline bool WhisperLoadModel(const char*) { return false; }
inline bool WhisperTranscribe(const float*, int, int, char*, int) { return false; }
inline bool WhisperIsModelLoaded() { return false; }
inline void WhisperFreeModel() {}
inline std::vector<std::string> WhisperListModels(const char*) { return {}; }
#endif

} // namespace whisper
} // namespace vaani

// Export function registered from injector.mm's InitAll
Napi::Object InitWhisper(Napi::Env env, Napi::Object exports);

#endif // WHISPER_ENGINE_H
