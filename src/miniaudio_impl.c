#define MINIAUDIO_IMPLEMENTATION
#include "third_party/miniaudio.h"
#include <stdlib.h>
#include <string.h>

// -- Engine ---------------------------------------------------------------
void* pod_engine_new(void) {
    ma_engine* engine = (ma_engine*)malloc(sizeof(ma_engine));
    if (!engine) return NULL;
    ma_result r = ma_engine_init(NULL, engine);
    if (r != MA_SUCCESS) {
        free(engine);
        return NULL;
    }
    return engine;
}

void pod_engine_delete(void* p) {
    if (!p) return;
    ma_engine* engine = (ma_engine*)p;
    ma_engine_uninit(engine);
    free(engine);
}

// -- Decoder + Sound (with seek table for VBR MP3) ------------------------

typedef struct {
    ma_decoder decoder;
    ma_sound sound;
} PodSound;

void* pod_sound_new(void* enginePtr, const char* filePath) {
    ma_engine* engine = (ma_engine*)enginePtr;
    PodSound* ps = (PodSound*)malloc(sizeof(PodSound));
    if (!ps) return NULL;
    memset(ps, 0, sizeof(PodSound));

    // Init decoder with seek table — critical for long-distance VBR MP3 seeks.
    ma_decoder_config decCfg = ma_decoder_config_init_default();
    decCfg.seekPointCount = 4096;

    ma_result r = ma_decoder_init_file(filePath, &decCfg, &ps->decoder);
    if (r != MA_SUCCESS) {
        free(ps);
        return NULL;
    }

    // Init sound from the decoder data source
    r = ma_sound_init_from_data_source(
        engine, &ps->decoder, 0, NULL, &ps->sound);
    if (r != MA_SUCCESS) {
        ma_decoder_uninit(&ps->decoder);
        free(ps);
        return NULL;
    }

    return ps;
}

void pod_sound_delete(void* p) {
    if (!p) return;
    PodSound* ps = (PodSound*)p;
    ma_sound_uninit(&ps->sound);
    ma_decoder_uninit(&ps->decoder);
    free(ps);
}

void pod_sound_start(void* p) {
    if (!p) return;
    ma_sound_start(&((PodSound*)p)->sound);
}

void pod_sound_stop(void* p) {
    if (!p) return;
    ma_sound_stop(&((PodSound*)p)->sound);
}

int pod_sound_is_playing(void* p) {
    if (!p) return 0;
    return ma_sound_is_playing(&((PodSound*)p)->sound) ? 1 : 0;
}

uint64_t pod_sound_get_cursor_pcm(void* p) {
    if (!p) return 0;
    ma_uint64 cursor = 0;
    ma_sound_get_cursor_in_pcm_frames(&((PodSound*)p)->sound, &cursor);
    return cursor;
}

uint32_t pod_sound_get_sample_rate(void* p) {
    if (!p) return 0;
    PodSound* ps = (PodSound*)p;
    ma_uint32 sampleRate = 0;
    ma_sound_get_data_format(&ps->sound, NULL, NULL, &sampleRate, NULL, 0);
    return sampleRate;
}

void pod_sound_seek_to_pcm(void* p, uint64_t frame) {
    if (!p) return;
    PodSound* ps = (PodSound*)p;

    // Stop the sound before touching the decoder — the engine thread
    // reads from the decoder through the sound, so concurrent access
    // causes buffer corruption (assertion failure in
    // ma_engine_node_process_pcm_frames__sound).
    ma_bool32 wasPlaying = ma_sound_is_playing(&ps->sound);
    ma_sound_stop(&ps->sound);

    ma_uint64 totalFrames = 0;
    ma_decoder_get_length_in_pcm_frames(&ps->decoder, &totalFrames);
    if (frame > totalFrames) frame = totalFrames;

    ma_decoder_seek_to_pcm_frame(&ps->decoder, frame);
    ma_sound_seek_to_pcm_frame(&ps->sound, frame);

    if (wasPlaying) {
        ma_sound_start(&ps->sound);
    }
}

float pod_sound_get_duration_seconds(void* p) {
    if (!p) return 0.0f;
    PodSound* ps = (PodSound*)p;
    float duration = 0.0f;
    ma_sound_get_length_in_seconds(&ps->sound, &duration);
    return duration;
}

void pod_sound_set_volume(void* p, float vol) {
    if (!p) return;
    ma_sound_set_volume(&((PodSound*)p)->sound, vol);
}

float pod_sound_get_volume(void* p) {
    if (!p) return 1.0f;
    return ma_sound_get_volume(&((PodSound*)p)->sound);
}
