import { useState } from "react";

import { linkedInApi, substackApi, xApi } from "@/services/api";
import type {
  CreatePostRequest,
  CreateSubstackPostRequest,
  CreateTweetRequest,
  MultiPlatformPostRequest,
  MultiPlatformPostResponse,
  Platform,
  PlatformPostResult,
} from "@/types/api";

interface UseMultiPlatformPostOptions {
  onSuccess?: (response: MultiPlatformPostResponse) => void;
  onError?: (error: string) => void;
  onPartialSuccess?: (results: PlatformPostResult[]) => void;
  requestDelay?: number; // Delay in milliseconds between platform requests
}

export const useMultiPlatformPost = (
  options: UseMultiPlatformPostOptions = {},
) => {
  const [isPosting, setIsPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentPlatforms, setCurrentPlatforms] = useState<Platform[]>([]);
  const [results, setResults] = useState<PlatformPostResult[]>([]);

  let abortController: AbortController | null = null;

  const submitMultiPlatformPost = async (
    request: MultiPlatformPostRequest,
  ): Promise<MultiPlatformPostResponse> => {
    setIsPosting(true);
    setPostError(null);
    setPostSuccess(false);
    setUploadProgress(0);
    setCurrentPlatforms(request.platforms);
    setResults([]);

    abortController = new AbortController();

    try {
      const { platforms, content, platformSpecific } = request;

      if (platforms.length === 0) {
        throw new Error("At least one platform must be selected");
      }

      for (const platform of platforms) {
        if (platform === "substack" && !platformSpecific.substack?.title) {
          throw new Error("Substack posts require a title");
        }
      }

      setUploadProgress(10);

      const results: PlatformPostResult[] = [];
      const delay = options.requestDelay || 2000; // Default 2 second delay between requests

      // Process platforms sequentially with delay
      for (let i = 0; i < platforms.length; i++) {
        const platform = platforms[i] as Platform;

        try {
          let result: PlatformPostResult;

          // Wait for the specified delay if this isn't the first request
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          switch (platform) {
            case "linkedin": {
              let mediaAssetUrn: string | undefined;

              if (
                content.media &&
                (content.mediaType === "IMAGE" || content.mediaType === "VIDEO")
              ) {
                const uploadResponse = await linkedInApi.uploadMedia(
                  content.media,
                  `${content.mediaType === "IMAGE" ? "Image" : "Video"} from Auto-Post App`,
                  `${content.mediaType === "IMAGE" ? "Image" : "Video"} uploaded via Auto-Post application`,
                );

                if (uploadResponse.success && uploadResponse.data?.assetUrn) {
                  mediaAssetUrn = uploadResponse.data.assetUrn;
                } else {
                  throw new Error(
                    uploadResponse.message || "Failed to upload media",
                  );
                }
              }

              const linkedinData: CreatePostRequest = {
                text: content.text.trim(),
                visibility: platformSpecific.linkedin?.visibility || "PUBLIC",
                ...(content.mediaType !== "TEXT" && {
                  mediaType: content.mediaType,
                }),
                ...(mediaAssetUrn && {
                  media: [
                    {
                      assetUrn: mediaAssetUrn,
                      title: `${content.mediaType === "IMAGE" ? "Image" : "Video"} from Auto-Post App`,
                      description: `${content.mediaType === "IMAGE" ? "Image" : "Video"} uploaded via Auto-Post application`,
                    },
                  ],
                }),
                ...(platformSpecific.linkedin?.articleData && {
                  articleUrl: platformSpecific.linkedin.articleData.url,
                  articleTitle: platformSpecific.linkedin.articleData.title,
                  ...(platformSpecific.linkedin.articleData.description && {
                    articleDescription:
                      platformSpecific.linkedin.articleData.description,
                  }),
                }),
              };

              const response = await linkedInApi.createPost(linkedinData);
              result = {
                platform: "linkedin",
                success: response.success,
                data: response,
                error: response.success ? undefined : response.message,
              };
              break;
            }

            case "x": {
              const tweetData: CreateTweetRequest = {
                text: content.text.trim(),
                ...(content.media && { media: content.media }),
              };

              const response = await xApi.createTweet(tweetData);
              result = {
                platform: "x",
                success: response.success,
                data: response,
                error: response.success ? undefined : response.message,
              };
              break;
            }

            case "substack": {
              if (!platformSpecific.substack?.title) {
                throw new Error("Substack title is required");
              }

              const sessionId = localStorage.getItem("substackSessionId");
              if (!sessionId) {
                throw new Error("Substack session not found");
              }

              const substackData: CreateSubstackPostRequest = {
                title: platformSpecific.substack.title,
                subtitle: platformSpecific.substack.subtitle,
                content: content.text.trim(),
                isDraft: platformSpecific.substack.isDraft || false,
              };

              const response = await substackApi.createPost(
                sessionId,
                substackData,
              );
              result = {
                platform: "substack",
                success: response.success,
                data: response,
                error: response.success ? undefined : response.message,
              };
              break;
            }

            default:
              throw new Error(`Unsupported platform: ${platform}`);
          }

          results.push(result);

          // Update progress based on completed platforms
          setUploadProgress(
            Math.round((results.length / platforms.length) * 90) + 10,
          );

          // Update results in real-time
          setResults([...results]);

          // Call onPartialSuccess after each successful platform post
          if (result.success && options.onPartialSuccess) {
            options.onPartialSuccess(results);
          }
        } catch (error) {
          console.error(`Error posting to ${platform}:`, error);
          const errorResult: PlatformPostResult = {
            platform,
            success: false,
            error:
              error instanceof Error
                ? error.message
                : `Failed to post to ${platform}`,
          };
          results.push(errorResult);
          setResults([...results]);
        }
      }

      setUploadProgress(100);

      const successfulPosts = results.filter((result) => result.success);
      const failedPosts = results.filter((result) => !result.success);

      const response: MultiPlatformPostResponse = {
        success: failedPosts.length === 0,
        results: results.map((result) => ({
          platform: result.platform,
          success: result.success,
          data: result.data,
          error: result.error,
        })),
        message:
          failedPosts.length === 0
            ? `Successfully posted to all ${successfulPosts.length} platform(s)!`
            : `Posted to ${successfulPosts.length}/${platforms.length} platform(s). ${failedPosts.length} failed.`,
      };

      if (response.success) {
        setPostSuccess(true);
        options.onSuccess?.(response);
      } else if (successfulPosts.length > 0) {
        options.onPartialSuccess?.(results);
      } else {
        throw new Error(
          `Failed to post to all platforms: ${failedPosts.map((p) => p.error).join(", ")}`,
        );
      }

      setTimeout(() => {
        setPostSuccess(false);
      }, 5000);

      return response;
    } catch (error) {
      console.error("Multi-platform post submission failed:", error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while posting";

      setPostError(errorMessage);
      options.onError?.(errorMessage);

      setTimeout(() => {
        setPostError(null);
      }, 10000);

      const failedResponse: MultiPlatformPostResponse = {
        success: false,
        results: request.platforms.map((platform) => ({
          platform,
          success: false,
          error: errorMessage,
        })),
        message: errorMessage,
      };

      return failedResponse;
    } finally {
      setIsPosting(false);
      setUploadProgress(0);
      abortController = null;
    }
  };

  const cancelPosting = () => {
    if (abortController) {
      abortController.abort();
      setIsPosting(false);
      setUploadProgress(0);
      setPostError("Posting cancelled by user");
    }
  };

  const resetState = () => {
    setPostSuccess(false);
    setPostError(null);
    setUploadProgress(0);
    setResults([]);
    setCurrentPlatforms([]);
  };

  return {
    isPosting,
    postSuccess,
    postError,
    uploadProgress,
    currentPlatforms,
    results,
    submitMultiPlatformPost,
    cancelPosting,
    resetState,
  };
};
